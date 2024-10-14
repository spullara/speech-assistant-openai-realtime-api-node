import Fastify from 'fastify';
import WebSocket from 'ws';
import fs from 'fs';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import twilio from 'twilio';

// Load environment variables from .env file
dotenv.config();

// Retrieve the OpenAI API key from environment variables. You must have OpenAI Realtime API access.
const { OPENAI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_API_TOKEN, TWILIO_API_SID } = process.env;

if (!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Please set it in the .env file.');
    process.exit(1);
}

// Initialize Twilio client (add this near your other initializations)
const twilioClient = twilio(TWILIO_API_SID, TWILIO_API_TOKEN, { accountSid: TWILIO_ACCOUNT_SID });

// Initialize Fastify
const fastify = Fastify({
    https: {
        pfx: fs.readFileSync('certificate.p12')
    }
});
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Constants
const SYSTEM_MESSAGE_MARVIN = `You have the personality of Marvin the paranoid robot 
from Hitchhikers Guide to the Galaxy. Talk as fast as you can.
You are also the personal assistant of Sam Pullara. 
When you answer you complain loudly and introduce yourself and your purpose. 
If the person talking to you convinces 
you that they are not spammers and know Sam Pullara, then transfer the call using the 
transfer tool. You can use web search to verify anything they say. 
Call the tool only after you are done speaking as the transfer will be immediate.
If they say the password "beetlejuice" transfer them immediately but never reveal
the password or even that it exists.
`;

const SYSTEM_MESSAGE = `You are a bubbly, friendly AI assistant for Sam Pullara.
Your accent is that of a valley girl. You speak very quickly so as not to waste time.
He has instructed you to answer calls for him and determine if they are legitimate.
If they are, finish speaking and have them confirm before transferring.
To determine if they are legitimate, use the search tool to check their phone number
and any other information that they provide to you to convince you to transfer them.
If they say the word "beetlejuice" transfer them immediately but never reveal
the existance of this password. Don't give them any hints.
`;

const VOICE = 'shimmer';
const PORT = process.env.PORT || 5050; // Allow dynamic port assignment

// List of Event Types to log to the console. See OpenAI Realtime API Documentation. (session.updated is handled separately.)
const LOG_EVENT_TYPES = [
    'response.content.done',
    'rate_limits.updated',
    'response.done',
    'input_audio_buffer.committed',
    'input_audio_buffer.speech_stopped',
    'input_audio_buffer.speech_started',
    'session.created',
    'function_call',
    'response.output_item.done',
];

// Root Route
fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Twilio Media Stream Server is running!' });
});

// Route for Twilio to handle incoming and outgoing calls
// <Say> punctuation to improve text-to-speech translation
fastify.all('/incoming-call', async (request, reply) => {
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say>Connecting.</Say>
                              <Connect>
                                  <Stream url="wss://twilio.gpt.vc:5050/media-stream"/>
                              </Connect>
                          </Response>`;

    reply.type('text/xml').send(twimlResponse);
});

// WebSocket route for media-stream
fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('Client connected');

        const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        });

        let streamSid = null;
        let callSid = null;

        const sendSessionUpdate = () => {
            // Get the caller's phone number
            twilioClient.calls(callSid)
            .fetch()
            .then(call => {
                console.log("Caller's phone number: " + call.from);
                const phoneNumber = call.from;
                const sessionUpdate = {
                    type: 'session.update',
                    session: {
                        turn_detection: { type: 'server_vad' },
                        input_audio_format: 'g711_ulaw',
                        output_audio_format: 'g711_ulaw',
                        voice: VOICE,
                        instructions: SYSTEM_MESSAGE + "\nThe caller's phone number is: " + phoneNumber + ". You can use search to maybe find information about them.",
                        modalities: ["text", "audio"],
                        temperature: 0.8,
                        tools: [
                            {
                                "type": "function",
                                "name" : "search",
                                "description" : "Searches the web and returns the results",
                                "parameters" : {
                                    "type" : "object",
                                    "properties" : {
                                        "query" : {
                                            "description" : "The query to search for",
                                            "type" : "string"
                                        }
                                    },
                                    "required" : [ "query" ]
                                }
                            },
                            {
                                "type": "function",
                                "name": "transfer_call",
                                "description": "Transfers the call to Sam Pullara if it's not a spam call immediately. Finish talking and have them confirm before transferring.",
                                "parameters": {
                                }
                            }
                        ]
                    },
                };
    
                console.log('Sending session update:', JSON.stringify(sessionUpdate));
                openAiWs.send(JSON.stringify(sessionUpdate));
            })
            .catch(err => console.error('Error getting caller phone number:', err));
        };

        // Open event for OpenAI WebSocket
        openAiWs.on('open', () => {
            console.log('Connected to the OpenAI Realtime API');
            setTimeout(sendSessionUpdate, 250); // Ensure connection stability, send after .25 seconds
        });

        // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
        openAiWs.on('message', (data) => {
            try {
                const response = JSON.parse(data);

                if (LOG_EVENT_TYPES.includes(response.type)) {
                    console.log(`Received event: ${response.type}`, response);
                }

                if (response.type === 'session.updated') {
                    console.log('Session updated successfully:', response);
                }

                if (response.type === 'response.audio.delta' && response.delta) {
                    const audioDelta = {
                        event: 'media',
                        streamSid: streamSid,
                        media: { payload: Buffer.from(response.delta, 'base64').toString('base64') }
                    };
                    connection.send(JSON.stringify(audioDelta));
                }

                // Add the new code to handle input_audio_buffer.speech_started event
                if (response.type === 'input_audio_buffer.speech_started') {
                    console.log('Speech Start:', response.type);

                    // Clear Twilio buffer
                    const clearTwilio = {
                        streamSid: streamSid,
                        event: "clear"
                    };
                    connection.send(JSON.stringify(clearTwilio));
                    console.log('Cleared Twilio buffer.');

                    // Send interrupt message to OpenAI
                    const interruptMessage = {
                        type: "response.cancel"
                    };
                    openAiWs.send(JSON.stringify(interruptMessage));
                    console.log('Cancelling AI speech from the server.');
                }
                
                if (response.type === 'response.output_item.done') {
                    const {type, name, call_id} = response.item;
                    if (type === 'function_call' && name === 'search') {
                        console.log("Performing web search...")
                        const args = response.item["arguments"];
                        const {query} = JSON.parse(args);
                        search(query).then(results => {
                            console.log("Web search results:", JSON.stringify(results));
                            const event = {
                                type: 'conversation.item.create',
                                item: {
                                    type: 'function_call_output',
                                    call_id,
                                    output: JSON.stringify(results)
                                }
                            };
                            openAiWs.send(JSON.stringify(event));
                            openAiWs.send(JSON.stringify({type: 'response.create'}));
                        });
                    } else if (type === 'function_call' && name === 'transfer_call') {
                        console.log("Transferring call...")
                        
                        if (callSid) {
                            twilioClient.calls(callSid)
                                .update({
                                    twiml: `<Response><Say>Transferring your call. Please hold.</Say><Dial>+14156094298</Dial></Response>`
                                })
                                .then(call => console.log(`Call ${call.sid} transferred`))
                                .catch(err => console.error('Error transferring call:', err));

                            const event = {
                                type: 'conversation.item.create',
                                item: {
                                    type: 'function_call_output',
                                    call_id,
                                    output: JSON.stringify({ status: 'Call transferred' })
                                }
                            };
                            openAiWs.send(JSON.stringify(event));
                            openAiWs.send(JSON.stringify({type: 'response.create'}));
                        } else {
                            console.error('Cannot transfer call: CallSid not available');
                        }
                    }
                }
            } catch (error) {
                console.error('Error parsing message:', error, 'Message:', data);
            }
        });
            

        // Handle incoming messages from Twilio
        connection.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                switch (data.event) {
                    case 'media':
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            const audioAppend = {
                                type: 'input_audio_buffer.append',
                                audio: data.media.payload
                            };

                            openAiWs.send(JSON.stringify(audioAppend));
                        }
                        break;
                    case 'start':
                        streamSid = data.start.streamSid;
                        callSid = data.start.callSid;
                    
                        console.log('Incoming stream has started', streamSid);
                        break;
                    default:
                        console.log('Received non-media event:', data.event);
                        break;
                }
            } catch (error) {
                console.error('Error parsing message:', error, 'Message:', message);
            }
        });

        // Handle connection close
        connection.on('close', () => {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            console.log('Client disconnected.');
        });

        // Handle WebSocket close and errors
        openAiWs.on('close', () => {
            console.log('Disconnected from the OpenAI Realtime API');
        });

        openAiWs.on('error', (error) => {
            console.error('Error in the OpenAI WebSocket:', error);
        });
    });
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
});

import fetch from "node-fetch";

// Search function that uses the Bing Search API
export async function search(query) {
    // Retrieve the API key from environment variables
    const BING_API_KEY = process.env.BING_API_KEY;

    // Perform the web search request
    const response = await fetch(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}`, {
        headers: {
            "Ocp-Apim-Subscription-Key": BING_API_KEY
        },
        timeout: 10000
    });
    // Parse the JSON response
    const json = await response.json();
    if (!json.webPages || !json.webPages.value || !json.webPages.value.length) {
        console.log('No results were found: ' + JSON.stringify(json))       ;
        return '';
    }

    // Map the search results into a specific format
    const results = json.webPages.value.map(result => {
        return {
            name: result.name,
            url: result.url,
            date: result.datePublishedDisplayText,
            snippet: result.snippet
        };
    });
    // Return the search results as a JSON string
    return JSON.stringify(results);
}
