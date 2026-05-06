<div align="center">

# ⚡ SYNCDEV

### Real-Time Collaborative Code Editor

**Build Together • Code Together • Ship Faster**

---

![Version](https://img.shields.io/badge/version-1.0-blue)
![Build](https://img.shields.io/badge/build-passing-brightgreen)
![Status](https://img.shields.io/badge/status-active-success)
![Realtime](https://img.shields.io/badge/realtime-websocket-red)
![Architecture](https://img.shields.io/badge/architecture-distributed-orange)
![License](https://img.shields.io/badge/license-MIT-yellow)
![Maintained](https://img.shields.io/badge/maintained-yes-success)

---

### ENGINEERING A REAL TIME COLLABORATIVE DEVELOPMENT PLATFORM

</div>

---

# Overview

**SyncDev** is a dark-themed real-time collaborative code editor built as a production-style SaaS UI. It combines a VS Code-inspired coding workspace with meeting-style participant controls, live collaboration, and modern developer UI polish.

The system focuses on:

- Real-time collaboration
- Developer productivity
- Scalable backend design
- Clean UI architecture
- Authentication workflows
- Team engineering practices

---

# Live System Capabilities

## Real-Time Collaboration Engine

- Multi-user code editing via Monaco Editor
- Room-based collaboration with room IDs and copy link action
- Live synchronization with conflict-safe updates
- Participant tracking with sticky panel and scrollable list
- Socket event broadcasting
- Responsive 2-column participant grid with equal card sizing

## Authentication System

- Secure registration and login
- Google OAuth sign-in
- GitHub OAuth integration
- JWT-protected routes (HTTP + WebSocket)
- Backend validation and session workflows

## Developer Interface

- Brutalist minimal UI with dark engineering theme
- Neon green active speaker and hover states
- Sticky editor panels and scroll-optimized layout
- Bottom control bar with mic, camera, emoji, caption, hand, and end call actions
- Sticky header with room and language controls
- Responsive dashboard

## Backend Infrastructure

- Modular server structure with REST API architecture
- WebSocket communication with authenticated Socket.IO
- Environment configuration
- Scalable logic separation
- Room state management with graceful cleanup

---

# System Architecture

```
                        USER CLIENTS
        ┌─────────────────────────────────┐
        │  Developer Browser Sessions     │
        │  Collaborative Editor UI        │
        └──────────────┬──────────────────┘
                       │
                       │ HTTP + WebSocket
                       │
        ┌──────────────▼──────────────────┐
        │        APPLICATION SERVER        │
        │  Node.js Runtime                │
        │  Express API Layer              │
        │  Socket Communication Layer     │
        └──────────────┬──────────────────┘
                       │
                       │ State Management
                       │
        ┌──────────────▼──────────────────┐
        │        DATA MANAGEMENT           │
        │ Users                           │
        │ Rooms                           │
        │ Sessions                        │
        └─────────────────────────────────┘
```

---

# Technology Stack

| Layer    | Technologies                          |
| -------- | ------------------------------------- |
| Frontend | React, Vite, Monaco Editor, WebRTC    |
| Backend  | Node.js, Express.js, Socket.IO       |
| Database | MongoDB                               |
| Auth     | JWT, bcrypt, Google OAuth, GitHub OAuth |
| Tools    | Git, GitHub, VS Code                  |

---

# Performance Metrics

| Parameter      | Specification    |
| -------------- | ---------------- |
| Collaboration  | Multi User       |
| Sync Model     | WebSocket        |
| Architecture   | Client Server    |
| Latency        | Near Real-Time   |
| Scalability    | Modular          |
| Authentication | Secure Routes    |
| Code Structure | Production Grade |

---

# Project Structure

```
SyncDev
├── Client
│   ├── src/
│   │   ├── App.jsx          — routes auth, dashboard, and editor screens
│   │   ├── pages/
│   │   │   ├── Editor.jsx   — workspace, participant panel, toolbar
│   │   │   └── Dashboard.jsx — room creation and join
│   │   ├── components/      — FileTree, TabBar, RunTerminal, etc.
│   │   ├── hooks/           — useFileSystem and custom hooks
│   │   ├── utils/           — file reading, repo paths
│   │   ├── api/             — GitHub API integration
│   │   └── index.css        — dark SaaS theme and layout styles
│   ├── index.html
│   └── vite.config.js
├── Server
│   ├── server.js            — app entry point + Socket.IO handlers
│   ├── config.js            — environment configuration
│   ├── middleware/
│   │   └── authJwt.js       — JWT authentication middleware
│   ├── models/
│   │   └── User.js          — MongoDB user model
│   ├── routes/
│   │   ├── Auth.js          — register, login, Google OAuth
│   │   ├── githubOAuth.js   — GitHub OAuth flow
│   │   ├── githubImport.js  — GitHub repo import
│   │   └── execute.js       — code execution endpoint
│   └── services/
│       ├── githubCommit.js  — GitHub commit service
│       └── githubRepoImport.js — repo import service
├── README.md
└── .gitignore
```

---

# Getting Started

## Clone Repository

```bash
git clone https://github.com/yourusername/SyncDev--RealTime---Code-Editor-.git
cd SyncDev--RealTime---Code-Editor-
```

## Install Dependencies

```bash
# Client
cd Client && npm install

# Server
cd ../Server && npm install
```

## Environment Setup

Copy `.env.example` to `.env` in both `Client/` and `Server/` directories and fill in the required values.

## Run the Application

```bash
# Start the backend server
cd Server && npm start

# In a new terminal, start the frontend
cd Client && npm run dev
```

Open the app in your browser and join a room via the dashboard.

---

# Application Workflow

1. **User Login** — Register or sign in (email/password, Google, or GitHub)
2. **Room Creation** — Create a new room or join an existing one
3. **Participants Join** — Others connect using the room code
4. **Socket Connection** — Authenticated WebSocket connection established
5. **Real-Time Editing** — Collaborative code editing via Monaco Editor
6. **Code Synchronization** — Changes broadcast instantly to all participants

---

# Future Roadmap

- Code execution environment
- Video collaboration
- Voice communication
- File sharing system
- AI code suggestions
- GitHub integration
- Docker deployment
- Kubernetes scaling
- Role permissions
- Logging infrastructure

---

# Engineering Team

## Frontend Engineering

**Jai Surya Kumar** — Frontend Developer, UI Architecture & Design Systems
**Prahlad Kumar Jha** — Frontend Developer, Component Development

## Backend Engineering

**Akhilesh Guleria** — Backend Developer, Authentication Systems
**Shivansh Singh** — Backend Developer, Real-Time Communication

## System Architecture & DevOps

**Prahlad and Jai** — System Architect, CI/CD Pipeline Engineering

---

# Maintainer

**Jai Surya Kumar** — Full Stack Developer, Real-Time Systems Builder

---

# Contribution Guidelines

Contributions are welcome. To contribute:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push the branch
5. Create a Pull Request

---

# License

MIT License

---

# Engineering Philosophy

**"Great software is engineered through collaboration."**

---

<div align="center">

# SYNCDEV ⚡

### REAL TIME ENGINEERING PLATFORM

</div>


## Security note for terminal preview ports
Ports 3001–3999 are reserved for per-room sandbox previews and should not be exposed publicly in production. Route preview traffic through the Server `/preview/:roomId` proxy on an internal network.
