<div align="center">
  <img src="./scribesnap_name_logo__closer.svg" alt="ScribeSnap" height="60" />
  <br /><br />
  <p>
    <img alt="Node version" src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" />
    <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white" />
    <img alt="Express" src="https://img.shields.io/badge/Express-4-000000?style=flat-square&logo=express&logoColor=white" />
    <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-3ECF8E?style=flat-square&logo=supabase&logoColor=white" />
    <img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
  </p>
  <p><strong>Extract transcripts from YouTube, Vimeo, TikTok, and more — then unlock AI-powered study tools in one click.</strong></p>
</div>

---

## About

**ScribeSnap** is a full-stack web application that pulls transcripts from videos across multiple platforms and enriches them with AI features: summaries, key insights, auto-generated flashcards, study guides, and interactive Q&A chat.

Whether you're a student reviewing a lecture, a researcher skimming a conference talk, or a professional turning webinars into notes, ScribeSnap converts any video into structured, searchable knowledge — instantly.

---

## Features

### Transcript Extraction
- **Multi-platform support** — YouTube, Vimeo, TikTok, Twitter/X, Instagram, Facebook, Loom, Wistia, Dailymotion
- **Auto-subtitle fallback** — tries native captions first, then falls back to Supadata for videos without them
- **Streaming delivery** — transcripts stream to the UI via Server-Sent Events (SSE) so you see content as it arrives
- **Timestamp preservation** — retains original timecodes for navigation

### AI Tools (powered by Groq + OpenRouter fallback)
- **Summary** — concise TL;DR of any video
- **Key Insights** — bullet-point takeaways extracted from the transcript
- **Flashcards** — auto-generated Q&A cards with topic tags; full-screen flip UI with known/unknown tracking
- **Study Guide** — structured document with overview, learning objectives, key concepts, sections, and review questions
- **Chapter Detection** — splits long videos into labeled chapters automatically
- **AI Chat** — ask follow-up questions about the transcript in a conversational interface

### Account & Credits
- **Supabase Auth** — email/password sign-up and login
- **Credit system** — authenticated users get a credit allowance; anonymous users get a limited free tier (configurable)
- **Per-user rate limiting** — separate RPM caps for authenticated vs. anonymous users
- **Token validation caching** — 60-second TTL cache on Supabase JWT checks to reduce auth latency

### Export
- Copy transcript to clipboard (plain text or formatted)
- Download as `.txt` file
- SRT subtitle format export
