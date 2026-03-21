// services/auth.js — Google OAuth unificado
// Valida domínio @divinofogao.com.br e carrega perfil da planilha de usuários
'use strict';

require('dotenv').config();

const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { buscarUsuario } = require('./permissoes');

const DOMINIO = 'divinofogao.com.br';

passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  (process.env.BASE_URL || 'http://localhost:3000') + '/auth/google/callback',
}, async function(accessToken, refreshToken, profile, done) {
    try {
        const email = (profile.emails?.[0]?.value || '').toLowerCase();

        // Só aceita email do domínio da empresa
        if (!email.endsWith('@' + DOMINIO)) {
            return done(null, false, { message: 'dominio_invalido' });
        }

        // Carrega perfil e módulos da planilha
        const perfil = await buscarUsuario(email);

        if (!perfil) {
            return done(null, false, { message: 'sem_acesso' });
        }

        return done(null, {
            id:       profile.id,
            nome:     profile.displayName,
            email:    email,
            foto:     profile.photos?.[0]?.value || '',
            modulos:  perfil.modulos,
            isMaster: perfil.isMaster || false,
        });
    } catch (err) {
        return done(err, null);
    }
}));

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

module.exports = passport;
