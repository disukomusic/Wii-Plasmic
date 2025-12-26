/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react/display-name */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from 'react';
import { BskyAgent } from '@atproto/api';
import { DataProvider } from '@plasmicapp/host';

// --- Helper: Image Compression ---
const compressImage = async (blob: Blob, maxSizeMB: number = 0.95): Promise<Blob> => {
  // 1. If already small enough, return immediately
  if (blob.size <= maxSizeMB * 1024 * 1024) return blob;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url); // Clean up memory

      // 2. Calculate new dimensions (Max 2000px usually fits nicely in 1MB)
      const MAX_DIMENSION = 2000;
      let width = img.width;
      let height = img.height;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height *= MAX_DIMENSION / width;
          width = MAX_DIMENSION;
        } else {
          width *= MAX_DIMENSION / height;
          height = MAX_DIMENSION;
        }
      }

      // 3. Draw to Canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(blob); // Fallback to original if canvas fails
        return;
      }

      // White background for JPEGs (handles transparent PNGs converting to black)
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      // 4. Export to Blob (Iteratively reduce quality if needed)
      // Start at 0.8 quality (good balance)
      const attemptCompression = (quality: number) => {
        canvas.toBlob(
            (compressedBlob) => {
              if (!compressedBlob) {
                resolve(blob);
                return;
              }

              // If good, or quality is already too low, resolve
              if (compressedBlob.size <= maxSizeMB * 1024 * 1024 || quality <= 0.5) {
                resolve(compressedBlob);
              } else {
                // Try again with lower quality
                attemptCompression(quality - 0.1);
              }
            },
            'image/jpeg',
            quality
        );
      };

      attemptCompression(0.8);
    };

    img.onerror = (err) => reject(err);
    img.src = url;
  });
};

const flattenEmbed = (embed: any) => {
  if (!embed) return null;

  // Handle 'recordWithMedia' (Quote + Image)
  let record = embed.record;
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
    record = embed.record.record;
  }

  if (!record) return null;

  // Normal Quote: author is at the top level
  if (record.author) {
    return record;
  }

  // Self Quote / Nested Record: author is inside another .record property
  if (record.record?.author) {
    return record.record;
  }

  return null;
};

const getDisplayImages = (embed: any) => {
  if (!embed) return [];

  // 1. Standard Images (post.embed.images)
  if (Array.isArray(embed.images)) {
    return embed.images;
  }

  // 2. Quote + Media (post.embed.media.images)
  if (embed.media && Array.isArray(embed.media.images)) {
    return embed.media.images;
  }

  // 3. Fallback: External link thumbnail (wrapped in an array for consistency)
  if (embed.external?.thumb) {
    return [{ fullsize: embed.external.thumb, thumb: embed.external.thumb, alt: embed.external.title }];
  }

  return [];
};

const getDisplayVideo = (embed: any) => {
  if (!embed) return null;

  // 1. Standard Video View
  if (embed.$type === 'app.bsky.embed.video#view') {
    return {
      playlist: embed.playlist, // This is the .m3u8 URL
      thumbnail: embed.thumbnail,
      alt: embed.alt,
      cid: embed.cid
    };
  }

  // 2. Video + Quote (recordWithMedia)
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' &&
      embed.media?.$type === 'app.bsky.embed.video#view') {
    return {
      playlist: embed.media.playlist,
      thumbnail: embed.media.thumbnail,
      alt: embed.media.alt,
      cid: embed.media.cid
    };
  }

  return null;
};

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

  //Posting
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);


  //Likes
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

      const normalizedData = data.map((item: any) => {
        const embed = item.post.embed;
        return {
          ...item,
          quote: flattenEmbed(embed),
          displayImages: getDisplayImages(embed),
          displayVideo: getDisplayVideo(embed),
          externalLink: embed?.$type === 'app.bsky.embed.external#view' ? embed.external : null
        };
      });
      setPosts(normalizedData);

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
    },

    createPost: async (
        text: string,
        quoteUri?: string,
        quoteCid?: string,
        replyParentUri?: string,
        replyParentCid?: string,
        replyRootUri?: string,
        replyRootCid?: string
    ) => {
      if (!agent.hasSession) {
        console.error("Not logged in");
        return;
      }

      if (!text || !text.trim()) {
        console.error("Post text is empty");
        return;
      }

      setPosting(true);
      setPostError(null);

      try {
        // Base post record
        const record: any = {
          $type: "app.bsky.feed.post",
          text: text.trim(),
          createdAt: new Date().toISOString(),
        };

        // Optional: reply threading
        if (replyParentUri && replyParentCid) {
          record.reply = {
            root: {
              uri: replyRootUri || replyParentUri,
              cid: replyRootCid || replyParentCid,
            },
            parent: {
              uri: replyParentUri,
              cid: replyParentCid,
            },
          };
        }

        // Optional: quote embed
        if (quoteUri && quoteCid) {
          record.embed = {
            $type: "app.bsky.embed.record",
            record: {
              uri: quoteUri,
              cid: quoteCid,
            },
          };
        }

        // Create post
        const res = await agent.post(record);

        // Refresh feed so the new post appears
        await fetchFeed();

        return res; // res.uri, res.cid
      } catch (e: any) {
        console.error("Create post failed:", e);
        setPostError(e?.message || "Create post failed");
      } finally {
        setPosting(false);
      }
    },

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
            likesLoading,
            posting,
            postError,
          }}
      >
        {children}
      </DataProvider>
  );
});