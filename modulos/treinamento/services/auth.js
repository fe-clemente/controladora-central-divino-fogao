'use strict';

require('dotenv').config();

const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const DOMINIO_PERMITIDO = 'divinofogao.com.br';

passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.BASE_URL + '/auth/google/callback',
}, function(accessToken, refreshToken, profile, done) {
    const email = (profile.emails && profile.emails[0] && profile.emails[0].value) || '';
    if (!email.endsWith('@' + DOMINIO_PERMITIDO)) {
        return done(null, false);
    }
    return done(null, {
        id:    profile.id,
        nome:  profile.displayName,
        email: email,
        foto:  (profile.photos && profile.photos[0] && profile.photos[0].value) || '',
    });
}));

passport.serializeUser(function(user, done)   { done(null, user); });
passport.deserializeUser(function(user, done) { done(null, user); });

module.exports = passport;