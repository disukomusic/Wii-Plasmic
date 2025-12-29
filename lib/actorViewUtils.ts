// lib/useActorFetchers.ts
import { useCallback } from 'react';
import { BskyAgent } from '@atproto/api';

interface UseActorFetchersProps {
    agent: BskyAgent | null;
    actor?: string;
    setActorFollowers: (followers: any[]) => void;
    setActorFollowing: (following: any[]) => void;
    setActorLists: (lists: any[]) => void;
}

export function useActorFetchers({
                                     agent,
                                     actor,
                                     setActorFollowers,
                                     setActorFollowing,
                                     setActorLists,
                                 }: UseActorFetchersProps) {
    const fetchActorFollowers = useCallback(async (actorHandle?: string) => {
        const targetActor = actorHandle || actor;
        if (!agent || !targetActor) return;

        try {
            const res = await agent.getFollowers({ actor: targetActor, limit: 100 });
            setActorFollowers(res.data.followers);
        } catch (e) {
            console.error("Failed to fetch followers:", e);
            setActorFollowers([]);
        }
    }, [agent, actor, setActorFollowers]);

    const fetchActorFollowing = useCallback(async (actorHandle?: string) => {
        const targetActor = actorHandle || actor;
        if (!agent || !targetActor) return;

        try {
            const res = await agent.getFollows({ actor: targetActor, limit: 100 });
            setActorFollowing(res.data.follows);
        } catch (e) {
            console.error("Failed to fetch following:", e);
            setActorFollowing([]);
        }
    }, [agent, actor, setActorFollowing]);

    const fetchActorLists = useCallback(async (actorHandle?: string) => {
        const targetActor = actorHandle || actor;
        if (!agent || !targetActor) return;

        try {
            const res = await agent.getLists({ actor: targetActor, limit: 100 });
            setActorLists(res.data.lists);
        } catch (e) {
            console.error("Failed to fetch lists:", e);
            setActorLists([]);
        }
    }, [agent, actor, setActorLists]);

    return {
        fetchActorFollowers,
        fetchActorFollowing,
        fetchActorLists,
    };
}
