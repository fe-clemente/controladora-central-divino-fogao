// services/auth.js — Google OAuth unificado
'use strict';

require('dotenv').config();

const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { buscarUsuario } = require('./permissoes');
// ✅ Importa gravarLog do masterService
const { gravarLog } = require('./masterService');

const DOMINIO = 'divinofogao.com.br';

passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  (process.env.BASE_URL || 'http://localhost:3000') + '/auth/google/callback',
    passReqToCallback: true, // ✅ precisamos do req para pegar o IP
}, async function(req, accessToken, refreshToken, profile, done) {
    try {
        const email = (profile.emails?.[0]?.value || '').toLowerCase();

        if (!email.endsWith('@' + DOMINIO)) {
            // ✅ Loga tentativa de domínio inválido
            await gravarLog(req, email || 'desconhecido', 'Tentativa login — domínio inválido', 'auth').catch(() => {});
            return done(null, false, { message: 'dominio_invalido' });
        }

        const perfil = await buscarUsuario(email);

        if (!perfil) {
            // ✅ Loga tentativa sem acesso
            await gravarLog(req, email, 'Tentativa login — sem acesso na planilha', 'auth').catch(() => {});
            return done(null, false, { message: 'sem_acesso' });
        }

        const usuario = {
            id:       profile.id,
            nome:     profile.displayName,
            email:    email,
            foto:     profile.photos?.[0]?.value || '',
            modulos:  perfil.modulos,
            isMaster: perfil.isMaster || false,
            isGestor: perfil.isGestor || false, // ACESSO AO GESTOR VISUALIZAR O SULTS
        };

        // ✅ Loga login bem-sucedido
        const tipoAcesso = usuario.isMaster ? 'master' : (perfil.modulos[0] || 'geral');
        await gravarLog(req, email, 'Login realizado', tipoAcesso).catch(() => {});

        return done(null, usuario);
    } catch (err) {
        return done(err, null);
    }
}));

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

module.exports = passport;