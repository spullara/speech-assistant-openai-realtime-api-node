# AI Call Assistant with Twilio Voice and OpenAI Realtime API

This application demonstrates how to create an AI-powered call assistant using Node.js, [Twilio Voice](https://www.twilio.com/docs/voice) with [Media Streams](https://www.twilio.com/docs/voice/media-streams), and [OpenAI's Realtime API](https://platform.openai.com/docs/). 

The application acts as a personal assistant, answering calls on behalf of the user and determining if the calls are legitimate before potentially transferring them.

## Features

- Answers incoming calls using an AI-powered assistant
- Uses OpenAI's GPT model to generate natural language responses
- Implements call screening and transfer functionality
- Utilizes web search to verify caller information
- Supports a secret password for immediate call transfer
- Voice (and TwiML, Media Streams)
- Phone Numbers

## Prerequisites

To use this application, you will need:

- **Node.js 18+** (We used `18.20.4` for development)
- **A Twilio account** with a phone number that has Voice capabilities
- **An OpenAI account** with access to the Realtime API
- **A Bing Search API key** for web search functionality

## Setup

1. Clone this repository
2. Run `npm install` to install dependencies
3. Create a `.env` file in the root directory with the following variables:

```
OPENAI_API_KEY=your_openai_api_key
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
BING_API_KEY=your_bing_api_key
USER_NAME=name_of_user_assistant_is_screening_for
```

4. You also need a certificate.p12 that matches your domain.

### Install required packages

Open a Terminal and run:
```
npm install
```

### Twilio setup

#### Point a Phone Number to your ngrok URL
In the [Twilio Console](https://console.twilio.com/), go to **Phone Numbers** > **Manage** > **Active Numbers** and click on the additional phone number you purchased for this app in the **Prerequisites**.

In your Phone Number configuration settings, update the first **A call comes in** dropdown to **Webhook**, and paste your forwarding URL (referenced above), followed by `/incoming-call`. For example, `https://[your-domain]/incoming-call`. Then, click **Save configuration**.

## Test the app
With the development server running, call the phone number you purchased in the **Prerequisites**. After the introduction, you should be able to talk to the AI Assistant. Have fun!

