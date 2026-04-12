
# SyncDev — Real-Time Collaborative Code Editor

## Overview
SyncDev is a dark-themed real-time collaborative code editor built as a production-style SaaS UI. It combines a VS Code-inspired coding workspace with meeting-style participant controls, live collaboration, and modern developer UI polish.

## Current Status
- Frontend: React + Vite with a brutalist developer aesthetic and neon green accents.
- Backend: Express + MongoDB for authentication, JWT, and room handling.
- Real-time collaboration: Socket.IO powers room join, code sync, and live user presence updates.
- Latest UI work: refined the editor layout, sticky participant panel, scrollable participant list, responsive participant cards, and polished toolbar structure.

## Project Structure
- `Client/`
  - React app powered by Vite
  - `src/App.jsx` routes auth, dashboard, and editor screens
  - `src/pages/Editor.jsx` contains the workspace, participant panel, and toolbar interactions
  - `src/index.css` manages the dark SaaS theme, editor layout, participant grid, and responsive behavior
- `Server/`
  - Express backend with auth routes
  - `models/User.js` MongoDB user model
  - `server.js` app entry point
  - `config.js` environment configuration

## Key Features
- Live collaborative editor using Monaco Editor
- Room-based sharing with room IDs and copy link action
- Sticky top participants and scrollable participant list
- Responsive 2-column participant grid with equal card sizing
- Neon green active speaker and hover states
- Bottom control bar with mic, camera, emoji, caption, hand, and end call actions
- Sticky header with room and language controls

## Development Notes
### Recent improvements
- Implemented `participants-pinned` section for the first two participants
- Ensured only the participant list scrolls, not the entire page
- Added modern thin scrollbar styling and background separation for sticky users
- Standardized participant cards with equal padding, border radius, and hover animations
- Refined header and toolbar flex layout for better alignment and spacing
- Verified frontend build successfully after updates

### Goals
- Continue improving the real-time UX for multi-user collaboration
- Add optional participant search and panel expand/collapse controls
- Enhance mobile responsiveness with drawer-style participant layout
- Add copy link success toast and connection status badges
- Finalize backend realtime room cleanup and auth protections

## Getting Started
1. Install dependencies
   - `cd Client && npm install`
   - `cd Server && npm install`
2. Run backend server
   - `cd Server && npm start`
3. Run frontend app
   - `cd Client && npm run dev`
4. Open the app in the browser and join a room via the dashboard

## Notes
This workspace is actively being developed and currently focuses on UI refinement and live participant UX. The current build output has been validated successfully.

---

## Contact
For follow-up or further UI improvements, continue working in the `Client/src/pages/Editor.jsx` and `Client/src/index.css` files.
=======
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

# Product Overview

**SyncDev** is a real-time collaborative development platform that allows multiple developers to work inside a shared coding environment with instant synchronization.

The system focuses on:

• Real-time collaboration
• Developer productivity
• Scalable backend design
• Clean UI architecture
• Authentication workflows
• Team engineering practices

---

# Live System Capabilities

## Real-Time Collaboration Engine

• Multi-user code editing
• Room based collaboration
• Live synchronization
• Participant tracking
• Socket event broadcasting
• Conflict safe updates

---

## Authentication System

• Secure registration
• Login system
• Protected routes
• Backend validation
• Session workflows

---

## Developer Interface

• Brutalist minimal UI
• Dark engineering theme
• Sticky editor panels
• Scroll optimized layout
• Responsive dashboard

---

## Backend Infrastructure

• Modular server structure
• REST API architecture
• WebSocket communication
• Environment configuration
• Scalable logic separation

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

## Frontend Engineering

HTML5
CSS3
JavaScript
Modern UI Patterns

---

## Backend Engineering

Node.js
Express.js
Socket.io

---

## Engineering Tools

Git
GitHub
VS Code

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

Client
│
├── components
├── pages
├── assets
├── styles
├── services
└── utilities

Server
│
├── controllers
├── routes
├── models
├── middleware
├── sockets
└── configuration

README.md
.gitignore
```

---

# Installation Guide

## Clone Repository

```
git clone https://github.com/yourusername/SyncDev--RealTime---Code-Editor-.git
```

---

## Client Setup

```
cd Client

npm install

npm start
```

---

## Server Setup

```
cd Server

npm install

npm run dev
```

---

# Application Workflow

User Login
→ Room Creation
→ Participants Join
→ Socket Connection
→ Real Time Editing
→ Code Synchronization

---

# CI/CD Pipeline Vision

Future engineering pipeline:

```
Developer Push
      │
      ▼
GitHub Repository
      │
      ▼
Automated Testing
      │
      ▼
Build Verification
      │
      ▼
Deployment Pipeline
```

---

# Future Roadmap

Engineering upgrades planned:

• Code execution environment
• Video collaboration
• Voice communication
• File sharing system
• AI code suggestions
• GitHub integration
• Docker deployment
• Kubernetes scaling
• Role permissions
• Logging infrastructure

---

# Engineering Team

## Frontend Engineering

**Jai Surya Kumar**
Frontend Developer
UI Architecture & Design Systems

**Prahlad Kumar Jha**
Frontend Developer
Component Development

---

## Backend Engineering

**Akhilesh Guleria**
Backend Developer
Authentication Systems

**Shivansh Singh**
Backend Developer
Real Time Communication

---

## System Architecture & DevOps

**Prahlad and Jai**
System Architect
CI/CD Pipeline Engineering

---

# Engineering Skills Demonstrated

This project demonstrates:

Full Stack Development
Real Time System Design
Socket Communication
Authentication Pipelines
Modular Architecture
Team Collaboration
Production Project Structure

---

# Why This Project Stands Out

This project highlights:

Real world engineering workflow
Scalable collaboration design
Modern backend communication
Professional repository structure
Team development capability

---

# Maintainer

**Jai Surya Kumar**

Full Stack Developer
Real Time Systems Builder

---

# Contribution Guidelines

Contributions are welcome.

To contribute:

Fork repository

Create feature branch

Commit changes

Push branch

Create Pull Request

---

# License

MIT License

---

# Support The Project

If this project helps you:

Star the repository

Fork the project

Share feedback

Contribute improvements

---

# Engineering Philosophy

**"Great software is engineered through collaboration."**

---

# SyncDev Mission

BUILD
COLLABORATE
ENGINEER
INNOVATE

---

# Future Vision

SyncDev aims to become:

Collaborative IDE
Cloud coding platform
AI assisted development tool
Developer productivity ecosystem

---

<div align="center">

# SYNCDEV ⚡

### REAL TIME ENGINEERING PLATFORM

</div>

