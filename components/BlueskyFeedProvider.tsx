/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react/display-name */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from 'react';
import { BskyAgent } from '@atproto/api';
import { DataProvider } from '@plasmicapp/host';

// --- Types ---
type FeedMode = 'author' | 'timeline' | 'feed' | 'search';

interface BlueskyProps {
  mode: FeedMode;
  actor?: string;       // For 'author' mode
  feedUrl?: string;     // For 'feed' mode
  searchQuery?: string; // For 'search' mode
  limit?: number;
  identifier?: string;
  appPassword?: string;
  children: any;
  auth: boolean;
}

// --- Helper: Parse Feed URI ---
const resolveFeedUri = async (agent: BskyAgent, url: string): Promise<string | null> => {
  if (!url) return null;
  if (url.startsWith('at://')) return url;

  const match = url.match(/profile\/([^/]+)\/feed\/([^/]+)/);

  if (match) {
    const identifier = match[1];
    const feedId = match[2];
    let did = identifier;

    try {
      if (!identifier.startsWith('did:')) {
        const res = await agent.resolveHandle({ handle: identifier });
        did = res.data.did;
      }
      return `at://${did}/app.bsky.feed.generator/${feedId}`;
    } catch (e) {
      console.error("Failed to resolve feed identifier:", e);
      return null;
    }
  }
  return null;
};

// --- Constant: Official 'Discover' Feed URI ---
const DISCOVER_FEED_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';

export const BlueskyFeedProvider = forwardRef((props: BlueskyProps, ref) => {
  const {
    mode = 'author',
    actor,
    feedUrl,
    searchQuery,
    limit = 20,
    identifier,
    appPassword,
    children
  } = props;

  // --- State ---
  const [posts, setPosts] = useState<any[]>([]);
  const [agent] = useState(() => new BskyAgent({ service: 'https://bsky.social' }));
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // New State for Likes
  const [currentPostLikes, setCurrentPostLikes] = useState<any[]>([]);
  const [likesLoading, setLikesLoading] = useState(false);

  
  
  //----------
  //MAIN FETCHING LOGIC
  //----------
  const fetchFeed = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let data: any[] = [];

      switch (mode) {
        case 'timeline':
          if (!agent.hasSession) {
            console.warn("Timeline requires login");
          }
          const tlRes = await agent.getTimeline({ limit });
          data = tlRes.data.feed;
          break;

        case 'search':
          if (!searchQuery) break;
          const searchRes = await agent.app.bsky.feed.searchPosts({ q: searchQuery, limit });
          data = searchRes.data.posts.map(post => ({ post }));
          break;

        case 'feed':
          const rawUrl = feedUrl || DISCOVER_FEED_URI;
          const uri = await resolveFeedUri(agent, rawUrl);

          if (uri) {
            const feedRes = await agent.app.bsky.feed.getFeed({ feed: uri, limit });
            data = feedRes.data.feed;
          } else {
            setError("Invalid Feed URL");
          }
          break;

        case 'author':
        default:
          if (!actor) break;
          const authorRes = await agent.getAuthorFeed({ actor, limit, filter: 'posts_no_replies' });
          data = authorRes.data.feed;
          break;
      }
      setPosts(data);

    } catch (e: any) {
      console.error("Fetch failed:", e);
      setError(e.message || "Error fetching feed");
    } finally {
      setLoading(false);
    }
  }, [agent, mode, actor, feedUrl, searchQuery, limit]);

  
  
  
  //---------------
  // Get a user's saved feeds
  //------------------
  const [savedFeeds, setSavedFeeds] = useState<any[]>([]);
  
  const fetchSavedFeeds = useCallback(async () => {
    if (!isLoggedIn) return;

    try {
      const prefsRes = await agent.app.bsky.actor.getPreferences();
      const prefs = prefsRes.data.preferences;
      console.log("Full preferences payload:", prefs);

      let feedUris: string[] = [];

      // Try the V2 preference first
      const v2 = prefs.find((p: any) =>
          p.$type === "app.bsky.actor.defs#savedFeedsPrefV2"
      );

      if (v2 && Array.isArray((v2 as any).items)) {
        (v2 as any).items.forEach((item: any) => {
          if (item.type === "feed" && item.value) {
            feedUris.push(item.value);
          }
        });
        console.log("V2 saved feed URIs:", feedUris);
      }

      // Fall back to legacy savedFeedsPref
      if (feedUris.length === 0) {
        const legacy = prefs.find((p: any) =>
            p.$type === "app.bsky.actor.defs#savedFeedsPref"
        );

        if (legacy) {
          const saved = (legacy as any).saved || [];
          const pinned = (legacy as any).pinned || [];
          feedUris.push(...saved, ...pinned);
          console.log("Legacy saved/pinned URIs:", feedUris);
        }
      }

      // De-duplicate
      feedUris = [...new Set(feedUris)];

      if (feedUris.length === 0) {
        console.warn("No saved feeds found in preferences.");
        setSavedFeeds([]);
        return;
      }

      // Fetch metadata for URIs
      const metadataRes =
          await agent.app.bsky.feed.getFeedGenerators({
            feeds: feedUris,
          });

      const metadataMap: Record<string, any> = {};
      metadataRes.data.feeds.forEach((f: any) => {
        metadataMap[f.uri] = f;
      });

      const fullFeeds = feedUris.map((uri) => ({
        uri,
        ...(metadataMap[uri] || {}),
      }));

      setSavedFeeds(fullFeeds);
    } catch (e) {
      console.error("Failed to fetch saved feeds:", e);
    }
  }, [agent, isLoggedIn]);

  // Trigger fetch when logged in
  useEffect(() => {
    if (isLoggedIn) fetchSavedFeeds();
  }, [isLoggedIn, fetchSavedFeeds]);
  
// 1. Session Resumption Hook (Keep as is, but ensure it sets a 'restoring' flag if needed)
  useEffect(() => {
    const tryResumeSession = async () => {
      const savedSession = localStorage.getItem('bsky_session');
      if (!savedSession) return;
      try {
        setLoading(true);
        const sessionData = JSON.parse(savedSession);
        await agent.resumeSession(sessionData);
        const profile = await agent.getProfile({ actor: sessionData.did });
        setCurrentUser(profile.data);
        setIsLoggedIn(true);
      } catch (e) {
        console.error("Session resumption failed:", e);
        localStorage.removeItem('bsky_session');
      } finally {
        setLoading(false);
      }
    };
    tryResumeSession();
  }, [agent]);

// 2. Data Fetching Hook
  useEffect(() => {
    // Prevent fetching if we are already in a loading state 
    // or if timeline mode is active but we aren't logged in yet.
    if (loading || (mode === 'timeline' && !isLoggedIn)) {
      return;
    }

    // Determine if we should debounce (for typing) or fetch immediately
    const isTextInputMode = mode === 'search' || mode === 'author';
    const delay = isTextInputMode ? 500 : 0;

    const handler = setTimeout(() => {
      console.log("Fetching feed now...");
      fetchFeed();
    }, delay);

    return () => clearTimeout(handler);
    
  }, [mode, isLoggedIn, searchQuery, actor, limit, feedUrl]);
  
  // --- Exposed Actions ---
  useImperativeHandle(ref, () => ({
    login: async () => {
      if (!identifier || !appPassword) return;
      try {
        setLoading(true);
        const response = await agent.login({ identifier, password: appPassword });

        // SAVE SESSION DATA
        // The response.data contains the AtpSessionData
        localStorage.setItem('bsky_session', JSON.stringify(response.data));

        const profile = await agent.getProfile({ actor: response.data.did });
        setCurrentUser(profile.data);
        setIsLoggedIn(true);
        await fetchFeed();
      } catch (e) {
        console.error("Login failed:", e);
      } finally {
        setLoading(false);
      }
    },

    logout: async () => {
      try {
        setLoading(true);
        await agent.logout();
        setIsLoggedIn(false);
        setCurrentUser(null);
        setPosts([]);
        setError(null);
        
        // CLEAR SESSION DATA
        localStorage.removeItem('bsky_session');

        setCurrentPostLikes([]);
        if (mode !== 'timeline') {
          await fetchFeed();
        }
      } catch (e) {
        console.error("Logout failed:", e);
      } finally {
        setLoading(false);
      }
    },

    fetchPostLikes: async (uri: string, maxLikers: number = 10) => {
      try {
        // Set loading state for this specific post
        setPosts(prev => prev.map(item =>
            item.post.uri === uri ? { ...item, likesLoading: true } : item
        ));

        // We pass the 'limit' to the getLikes call
        const res = await agent.getLikes({
          uri,
          limit: maxLikers
        });

        setPosts(prev => prev.map(item =>
            item.post.uri === uri
                ? {
                  ...item,
                  likers: res.data.likes, // Now limited by the API side
                  likesLoading: false
                }
                : item
        ));
      } catch (e: any) {
        console.error("Failed to fetch post likes:", e);
        setPosts(prev => prev.map(item =>
            item.post.uri === uri ? { ...item, likesLoading: false } : item
        ));
      }
    },

    likePost: async (uri: string, cid: string) => {
      if (!agent.hasSession) return console.error("Not logged in");

      const targetPost = posts.find(p => p.post.uri === uri);
      if(!targetPost) return;

      const isAlreadyLiked = !!targetPost.post.viewer?.like;

      setPosts(prev => prev.map(item => {
        if (item.post.uri !== uri) return item;
        const currentCount = item.post.likeCount || 0;
        return {
          ...item,
          post: {
            ...item.post,
            likeCount: isAlreadyLiked ? Math.max(0, currentCount - 1) : currentCount + 1,
            viewer: {
              ...item.post.viewer,
              like: isAlreadyLiked ? undefined : 'pending'
            }
          }
        };
      }));

      try {
        if (isAlreadyLiked) {
          await agent.deleteLike(targetPost.post.viewer.like);
        } else {
          const res = await agent.like(uri, cid);
          setPosts(prev => prev.map(item =>
              item.post.uri === uri
                  ? { ...item, post: { ...item.post, viewer: { ...item.post.viewer, like: res.uri } } }
                  : item
          ));
        }
      } catch (e) {
        console.error("Like action failed");
        fetchFeed();
      }
    },

    repostPost: async (uri: string, cid: string) => {
      if (!agent.hasSession) return console.error("No active session");

      const targetPost = posts.find(p => p.post.uri === uri);
      if (!targetPost) return;

      const existingRepostUri = targetPost.post.viewer?.repost;
      const isAlreadyReposted = !!existingRepostUri && existingRepostUri !== 'pending';

      setPosts(prev => prev.map(item => {
        if (item.post.uri !== uri) return item;
        const currentCount = item.post.repostCount || 0;
        return {
          ...item,
          post: {
            ...item.post,
            repostCount: isAlreadyReposted ? Math.max(0, currentCount - 1) : currentCount + 1,
            viewer: {
              ...item.post.viewer,
              repost: isAlreadyReposted ? undefined : 'pending'
            }
          }
        };
      }));

      try {
        if (isAlreadyReposted) {
          await agent.deleteRepost(existingRepostUri);
        } else {
          const res = await agent.repost(uri, cid);
          setPosts(prev => prev.map(item =>
              item.post.uri === uri
                  ? { ...item, post: { ...item.post, viewer: { ...item.post.viewer, repost: res.uri } } }
                  : item
          ));
        }
      } catch (e) {
        console.error("Bluesky API Error:", e);
        fetchFeed();
      }
    }
  }));

  return (
      <DataProvider
          name="bskyData"
          data={{
            posts,
            loading,
            isLoggedIn,
            currentUser,
            currentPostLikes,
            savedFeeds,
            likesLoading
          }}
      >
        {children}
      </DataProvider>
  );
});