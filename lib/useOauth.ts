
// lib/useOauth.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Agent } from "@atproto/api";
import {
    AuthorizeOptions,
    BrowserOAuthClient,
    OAuthSession,
    LoginContinuedInParentWindowError,
} from "@atproto/oauth-client-browser";

type Gettable<T> = () => PromiseLike<T> | T;

export function useOAuth(options: {
    clientId: string;
    handleResolver: string;
    responseMode?: "query" | "fragment";
    plcDirectoryUrl?: string;
    getScope?: Gettable<string | undefined>;
    getState?: Gettable<string | undefined>;
}) {
    const {
        clientId,
        handleResolver,
        responseMode = "query",
        plcDirectoryUrl,
    } = options;

    const getScope = options.getScope ?? (() => "atproto");
    const getState = options.getState ?? (() => undefined);

    const [client, setClient] = useState<BrowserOAuthClient | null>(null);
    const [session, setSession] = useState<OAuthSession | null>(null);
    const [isInitializing, setIsInitializing] = useState(true);
    const [isLoginPopup, setIsLoginPopup] = useState(false);

    const clientRef = useRef<BrowserOAuthClient | null>(null);

    useEffect(() => {
        const ac = new AbortController();
        let didAbort = false;
        setIsInitializing(true);

        // Helper to guard setState after abort
        const safeSet = <T,>(setter: (v: T) => void, v: T) => {
            if (!didAbort) setter(v);
        };

        const run = async () => {
            try {
                const c = await BrowserOAuthClient.load({
                    clientId,
                    handleResolver,
                    responseMode,
                    plcDirectoryUrl,
                    fetch: globalThis.fetch,
                    signal: ac.signal, // okay to pass; just handle AbortError
                });

                if (ac.signal.aborted) {
                    // Cleanup: don't retain client, dispose
                    c.dispose();
                    return;
                }

                clientRef.current = c;
                safeSet(setClient, c);

                try {
                    const r = await c.init();
                    if (r && !ac.signal.aborted) {
                        safeSet(setSession, r.session);
                    }
                } catch (err: any) {
                    // Ignore AbortError from init()/internal fetch
                    if (err?.name === "AbortError") {
                        return;
                    }
                    if (err instanceof LoginContinuedInParentWindowError) {
                        safeSet(setIsLoginPopup, true);
                    } else {
                        console.error("OAuth init failed:", err);
                    }
                }
            } catch (err: any) {
                // Ignore AbortError from load()
                if (err?.name === "AbortError") return;
                console.error("OAuth client load failed:", err);
            } finally {
                if (!ac.signal.aborted) safeSet(setIsInitializing, false);
            }
        };

        run();

        return () => {
            didAbort = true;
            ac.abort(); // This will trigger AbortError in pending ops—expected in dev
            // Dispose any created client
            if (clientRef.current) {
                try {
                    clientRef.current.dispose();
                } catch {/* no-op */}
                clientRef.current = null;
            }
        };
    }, [clientId, handleResolver, responseMode, plcDirectoryUrl]);

    const signIn = useCallback(
        async (input: string, authorizeOptions?: AuthorizeOptions) => {
            if (!clientRef.current) throw new Error("OAuth client not ready");

            const state = authorizeOptions?.state ?? (await getState()) ?? undefined;
            const scope = authorizeOptions?.scope ?? (await getScope()) ?? "atproto";

            const s = await clientRef.current.signIn(input, {
                ...authorizeOptions,
                scope,
                state,
            });

            setSession(s);
            return s;
        },
        [getScope, getState]
    );

    const signOut = useCallback(async () => {
        await session?.signOut();
        setSession(null);
    }, [session]);

    return useMemo(
        () => ({
            isInitializing,
            isInitialized: !!client,
            isLoginPopup,
            session,
            client,
            signIn,
            signOut,
            agent: session ? new Agent(session) : null,
        }),
        [isInitializing, isLoginPopup, session, client, signIn, signOut]
    );
}
