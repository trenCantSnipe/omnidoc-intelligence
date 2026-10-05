<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1_4cuRxC-cg6VMyict53EVod7Fcb-yc0T

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


---

## Hotel Operations Intelligence (`hotel-intelligence/`)

A separate, self-contained package in this repo: an AI operational-intelligence layer for hotels that sits on top of
existing PMS/OTA/utility systems (event detection, per-hotel baselines, anomaly detection, contextual reasoning,
recommendations with human approval, role-aware alerting, daily brief and a copilot). See
[`hotel-intelligence/README.md`](hotel-intelligence/README.md).
