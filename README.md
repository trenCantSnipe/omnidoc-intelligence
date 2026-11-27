# 📄 OmniDoc Intelligence

Drop in documents, datasets, images, audio or video, and OmniDoc summarizes and analyzes them, charts the numbers, and can read the summary back to you.

## Features

- **Multi-format input**: PDFs, text, CSV/spreadsheets, images, audio and video (sent as inline data to Gemini)
- **Automatic language detection** and summaries in your language
- **Data visualizer**: turns extracted figures into charts (Recharts)
- **Audio transcription** and **text-to-speech** read-back
- **Search-grounded follow-ups** to check claims against the web
- File preview modal and chat-style history sidebar

## Tech stack

React 19 · TypeScript · Vite · Recharts · Google Gemini API (multimodal, TTS, grounding)

## Run locally

```bash
git clone https://github.com/trenCantSnipe/omnidoc-intelligence.git && cd omnidoc-intelligence
npm install
echo "GEMINI_API_KEY=your_key_here" > .env.local
npm run dev
```

Get a free key at [Google AI Studio](https://aistudio.google.com/apikey). The key stays in `.env.local`, which is git-ignored.
