// server/models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
    },
    // Password optional for OAuth users (Bug 13 fix)
    password: {
        type: String,
        required: false, // OAuth users don't need passwords
    },
    // Track authentication provider
    authProvider: {
        type: String,
        enum: ['local', 'google', 'github'],
        default: 'local',
        required: true,
    },
    githubId: {
        type: String,
        sparse: true,
        unique: true,
    },
    githubUsername: { type: String },
    githubAccessToken: { type: String, select: false },
    githubRefreshToken: { type: String, select: false },
    githubTokenExpiry: { type: Date },
    resetToken: { type: String, select: false },
    resetTokenExpiry: { type: Date, select: false },
});

module.exports = mongoose.model('User', UserSchema);