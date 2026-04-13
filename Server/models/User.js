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
    password: {
        type: String,
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
});

module.exports = mongoose.model('User', UserSchema);