
'use client';

import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import {BskyAgent, AtpSessionData, AtpSessionEvent} from '@atproto/api';

type BlueskySessionCtx = {
    agent: BskyAgent;
    isLoggedIn: boolean;
    currentUser: any | null;
    login: (identifier: string, appPassword: string) => Promise<void>;
    logout: () => Promise<void>;
};

const BlueskyCtx = createContext<BlueskySessionCtx | null>(null);

export function BlueskyAuthProvider({children}: {children: React.ReactNode}) {
    const agent = useMemo(
        () =>
            new BskyAgent({
                service: 'https://bsky.social',
                // Persist session on create/refresh/clear so it's seamless across pages
                persistSession: (evt: AtpSessionEvent, sess?: AtpSessionData) => {
                    if (evt === 'create' || evt === 'refresh') {
                        localStorage.setItem('bsky_session', JSON.stringify(sess));
                    } else if (evt === 'clear') {
                        localStorage.removeItem('bsky_session');
                    }
                },
            }),
        []
    );

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [currentUser, setCurrentUser] = useState<any | null>(null);

    // Resume once on initial mount (if a session exists)
    useEffect(() => {
        (async () => {
            if (agent.hasSession) return;
            const saved = localStorage.getItem('bsky_session');
            if (!saved) return;
            try {
                const data = JSON.parse(saved);
                await agent.resumeSession(data);
                const profile = await agent.getProfile({actor: data.did});
                setCurrentUser(profile.data);
                setIsLoggedIn(true);
            } catch {
                localStorage.removeItem('bsky_session');
            }
        })();
    }, [agent]);

    const login = async (identifier: string, appPassword: string) => {
        const res = await agent.login({identifier, password: appPassword});
        const profile = await agent.getProfile({actor: res.data.did});
        setCurrentUser(profile.data);
        setIsLoggedIn(true);
    };

    const logout = async () => {
        await agent.logout();
        setIsLoggedIn(false);
        setCurrentUser(null);
    };

    return (
        <BlueskyCtx.Provider value={{agent, isLoggedIn, currentUser, login, logout}}>
            {children}
        </BlueskyCtx.Provider>
    );
}

export function useBluesky() {
    const ctx = useContext(BlueskyCtx);
    // If there is no context (like during pre-rendering), 
    // return a "null-safe" object instead of throwing an error.
    if (!ctx) {
        return {
            agent: null,
            isLoggedIn: false,
            currentUser: null,
            login: async () => {},
            logout: async () => {},
        } as unknown as BlueskySessionCtx;
    }
    return ctx;
}
