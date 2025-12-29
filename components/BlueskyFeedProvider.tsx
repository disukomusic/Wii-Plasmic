/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react/display-name */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from 'react';
import { BskyAgent } from '@atproto/api';
import { DataProvider } from '@plasmicapp/host';
import { useBluesky } from '@/lib/BlueskyAuthProvider';
import { compressImage, coerceToBlob } from '@/lib/MediaUtils';
import { flattenEmbed, getDisplayImages, getDisplayVideo, normalizePost} from '@/lib/NormalizeUtils';
import { FeedMode, BlueskyProps, DISCOVER_FEED_URI} from "@/lib/Types";
import { resolveFeedUri, createEmbed} from "@/lib/uriEmbed";
import {updateThreadNode} from "@/lib/UpdateThreadNode";
import {fetchThreadImpl} from "@/lib/Thread";
import {fetchFeedImpl} from "@/lib/Feed";

/* =========================================================================================
 * PROVIDER COMPONENT
 * ========================================================================================= */
export const BlueskyFeedProvider = forwardRef((props: BlueskyProps, ref) => {
  const {
    mode = 'author',
    actor,
    feedUrl,
    searchQuery,
    limit = 20,
    threadUri,
    children
  } = props;

  const { agent, isLoggedIn, currentUser, login, logout } = useBluesky();

  // --- General Feed State ---
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Interaction State ---
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [savedFeeds, setSavedFeeds] = useState<any[]>([]);

  // --- Thread State (Native Structure) ---
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  // We store the thread in 3 distinct parts for easy rendering:
  const [threadAncestors, setThreadAncestors] = useState<any[]>([]); // Parent chain
  const [threadFocused, setThreadFocused] = useState<any>(null);     // The main post
  const [threadReplies, setThreadReplies] = useState<any[]>([]);     // The children tree

  /* -----------------------------------------------------------------------------
   * THREAD FETCHING
   * ----------------------------------------------------------------------------- */
  const fetchThread = useCallback(async () => {
    await fetchThreadImpl({
      agent,
      threadUri,
      depth: props.threadDepth ?? 6,
      parentHeight: props.threadParentHeight ?? 80,
      setThreadLoading,
      setThreadError,
      setThreadAncestors,
      setThreadFocused,
      setThreadReplies,
    });
  }, [agent, threadUri, props.threadDepth, props.threadParentHeight]);
  
  /* -----------------------------------------------------------------------------
   * FEED FETCHING
   * ----------------------------------------------------------------------------- */
  const fetchFeed = useCallback(async () => {
    if (mode === "thread") {
      await fetchThread();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const normalizedData = await fetchFeedImpl({
        agent,
        mode,
        actor,
        feedUrl,
        searchQuery,
        limit,
      });

      setPosts(normalizedData);
    } catch (e: any) {
      console.error("Fetch failed:", e);
      setError(e?.message ?? "Error fetching feed");
    } finally {
      setLoading(false);
    }
  }, [agent, mode, actor, feedUrl, searchQuery, limit, fetchThread]);

  // Trigger fetch on prop changes
  useEffect(() => {
    if (loading) return;
    const isTextInputMode = mode === 'search' || mode === 'author';
    const delay = isTextInputMode ? 500 : 0;

    // Immediate fetch for thread mode to feel snappy
    if (mode === 'thread') {
      fetchThread();
      return;
    }

    const handler = setTimeout(() => fetchFeed(), delay);
    return () => clearTimeout(handler);
  }, [mode, isLoggedIn, searchQuery, actor, limit, feedUrl, threadUri]);
  
  /* -----------------------------------------------------------------------------
   * PREFERENCES (Saved Feeds)
   * ----------------------------------------------------------------------------- */
  const fetchSavedFeeds = useCallback(async () => {
    if (!isLoggedIn) return;

    try {
      const feeds = await fetchSavedFeedsImpl(agent);
      setSavedFeeds(feeds);
    } catch (e) {
      console.error("Failed to fetch saved feeds:", e);
    }
  }, [agent, isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn) fetchSavedFeeds();
  }, [isLoggedIn, fetchSavedFeeds]);

  useEffect(() => {
    if (isLoggedIn) fetchSavedFeeds();
  }, [isLoggedIn, fetchSavedFeeds]);
  

  /* -----------------------------------------------------------------------------
   * ACTIONS FOR PLASMIC
   * ----------------------------------------------------------------------------- */
  useImperativeHandle(ref, () => ({
    login: async () => {
      if (props.identifier && props.appPassword) {
        await login(props.identifier, props.appPassword);
      }
    },
    logout: async () => {
      await logout();
      setPosts([]);
    },

    // --- Like Post (Handles both Thread and List modes) ---
    likePost: async (uri: string, cid?: string) => {
      if (!agent) return;
      // 1. Identify current state to determine if we are Adding or Removing
      let isAlreadyLiked = false;
      let existingLikeUri: string | undefined;
      let cidToUse = cid;

      // Check Thread State
      if (mode === 'thread') {
        const checkNode = (n: any): any => {
          if (!n) return null;
          if (n.post?.uri === uri) return n;
          if (n.replies) {
            for(const r of n.replies) {
              const found = checkNode(r);
              if(found) return found;
            }
          }
          return null;
        };
        // Check focused, ancestors, or replies
        const node = checkNode(threadFocused)
            || threadAncestors.map(checkNode).find(Boolean)
            || threadReplies.map(checkNode).find(Boolean);

        if (node) {
          existingLikeUri = node.post.viewer?.like;
          cidToUse = cidToUse ?? node.post.cid;
        }
      }
      // Check List State
      else {
        const item = posts.find(p => p.post.uri === uri);
        if (item) {
          existingLikeUri = item.post.viewer?.like;
          cidToUse = cidToUse ?? item.post.cid;
        }
      }

      if (!cidToUse) return; // Can't like without CID
      isAlreadyLiked = !!(existingLikeUri && existingLikeUri !== 'pending');

      // 2. Optimistic Update Function
      const performUpdate = (prevItem: any) => {
        const currentCount = prevItem.post.likeCount || 0;
        return {
          ...prevItem,
          post: {
            ...prevItem.post,
            likeCount: isAlreadyLiked ? Math.max(0, currentCount - 1) : currentCount + 1,
            viewer: {
              ...prevItem.post.viewer,
              like: isAlreadyLiked ? undefined : 'pending',
            }
          }
        };
      };

      // 3. Apply Optimistic Updates
      if (mode === 'thread') {
        setThreadFocused(prev => updateThreadNode(prev, uri, performUpdate));
        setThreadAncestors(prev => updateThreadNode(prev, uri, performUpdate));
        setThreadReplies(prev => updateThreadNode(prev, uri, performUpdate));
      } else {
        setPosts(prev => prev.map(item => item.post.uri === uri ? performUpdate(item) : item));
      }

      // 4. API Call
      try {
        if (isAlreadyLiked) {
          await agent.deleteLike(existingLikeUri!);

          // When unliking, remove the current user from the likers array
          const removeSelf = (node: any) => ({
            ...node,
            // Filter out the current user's avatar from the local likers array
            likers: (node.likers || []).filter((l: any) => l.did !== currentUser?.did),
            post: { ...node.post, viewer: { ...node.post.viewer, like: undefined } }
          });

          if (mode === 'thread') {
            setThreadFocused(prev => updateThreadNode(prev, uri, removeSelf));
            setThreadAncestors(prev => updateThreadNode(prev, uri, removeSelf));
            setThreadReplies(prev => updateThreadNode(prev, uri, removeSelf));
          } else {
            setPosts(prev => prev.map(item => item.post.uri === uri ? removeSelf(item) : item));
          }
        } else {
          const res = await agent.like(uri, cidToUse);

          // Fetch the latest 5 likers to show avatars
          const likersRes = await agent.getLikes({ uri, limit: 5 });
          const latestLikers = likersRes.data.likes.map(l => l.actor);

          // Combine both updates: The official Like URI AND the Liker list
          const finalUpdate = (node: any) => ({
            ...node,
            likers: latestLikers, // This enables $props.currentItem.likers
            post: {
              ...node.post,
              viewer: { ...node.post.viewer, like: res.uri }
            }
          });

          if (mode === 'thread') {
            setThreadFocused(prev => updateThreadNode(prev, uri, finalUpdate));
            setThreadAncestors(prev => updateThreadNode(prev, uri, finalUpdate));
            setThreadReplies(prev => updateThreadNode(prev, uri, finalUpdate));
          } else {
            setPosts(prev => prev.map(item => item.post.uri === uri ? finalUpdate(item) : item));
          }
        }
      } catch (e) {
        console.error("Like failed, reverting", e);
        mode === 'thread' ? fetchThread() : fetchFeed();
      }
    },
    
    // --- Fetch post liker (users) ---
    fetchPostLikes: async (uri: string, limit: number = 20) => {
      if (!agent || !uri) return;

      try {
        // 1. Fetch the likers from the API
        const res = await agent.getLikes({ uri, limit });
        const actorList = res.data.likes.map(l => l.actor);

        // 2. Define the update function
        const updateWithLikers = (node: any) => ({
          ...node,
          likers: actorList // This populates $props.currentItem.likers
        });

        // 3. Apply to whichever state is currently active
        if (mode === 'thread') {
          setThreadFocused(prev => updateThreadNode(prev, uri, updateWithLikers));
          setThreadAncestors(prev => updateThreadNode(prev, uri, updateWithLikers));
          setThreadReplies(prev => updateThreadNode(prev, uri, updateWithLikers));
        } else {
          setPosts(prev => prev.map(item =>
              item.post.uri === uri ? updateWithLikers(item) : item
          ));
        }
      } catch (e) {
        console.error("Failed to load likers for action:", e);
      }
    },
    
    
    // --- Repost (Handles both Thread and List modes) ---
    repostPost: async (uri: string, cid: string) => {
      if (!agent) return;
      // 1. Identify current state to determine if we are Adding or Removing
      let isAlreadyReposted = false;
      let existingRepostUri: string | undefined;
      let cidToUse: string | undefined = cid;

      // Check Thread State
      if (mode === 'thread') {
        const checkNode = (n: any): any => {
          if (!n) return null;
          if (n.post?.uri === uri) return n;
          if (n.replies) {
            for (const r of n.replies) {
              const found = checkNode(r);
              if (found) return found;
            }
          }
          return null;
        };

        // Check focused, ancestors, or replies
        const node =
            checkNode(threadFocused) ||
            threadAncestors.map(checkNode).find(Boolean) ||
            threadReplies.map(checkNode).find(Boolean);

        if (node) {
          existingRepostUri = node.post.viewer?.repost;
          cidToUse = cidToUse || node.post.cid;
        }
      }
      // Check List State
      else {
        const item = posts.find((p) => p.post.uri === uri);
        if (item) {
          existingRepostUri = item.post.viewer?.repost;
          cidToUse = cidToUse || item.post.cid;
        }
      }

      if (!cidToUse) return; // Can't repost without CID
      isAlreadyReposted = !!(existingRepostUri && existingRepostUri !== 'pending');

      // 2. Optimistic Update Function
      const performUpdate = (prevItem: any) => {
        const currentCount = prevItem.post.repostCount || 0;
        return {
          ...prevItem,
          post: {
            ...prevItem.post,
            repostCount: isAlreadyReposted
                ? Math.max(0, currentCount - 1)
                : currentCount + 1,
            viewer: {
              ...prevItem.post.viewer,
              repost: isAlreadyReposted ? undefined : 'pending',
            },
          },
        };
      };

      // 3. Apply Optimistic Updates
      if (mode === 'thread') {
        setThreadFocused((prev) => updateThreadNode(prev, uri, performUpdate));
        setThreadAncestors((prev) => updateThreadNode(prev, uri, performUpdate));
        setThreadReplies((prev) => updateThreadNode(prev, uri, performUpdate));
      } else {
        setPosts((prev) =>
            prev.map((item) => (item.post.uri === uri ? performUpdate(item) : item))
        );
      }

      // 4. API Call
      try {
        if (isAlreadyReposted) {
          // Remove repost
          await agent.deleteRepost(existingRepostUri!);

          // Clear any pending/old repost value in state (count already handled optimistically)
          const clearRepost = (node: any) => ({
            ...node,
            post: {
              ...node.post,
              viewer: { ...node.post.viewer, repost: undefined },
            },
          });

          if (mode === 'thread') {
            setThreadFocused((prev) => updateThreadNode(prev, uri, clearRepost));
            setThreadAncestors((prev) => updateThreadNode(prev, uri, clearRepost));
            setThreadReplies((prev) => updateThreadNode(prev, uri, clearRepost));
          } else {
            setPosts((prev) =>
                prev.map((item) => (item.post.uri === uri ? clearRepost(item) : item))
            );
          }
        } else {
          // Create repost
          const res = await agent.repost(uri, cidToUse);

          // Set the official repost record uri (replace "pending")
          const finalizeRepost = (node: any) => ({
            ...node,
            post: {
              ...node.post,
              viewer: { ...node.post.viewer, repost: res.uri },
            },
          });

          if (mode === 'thread') {
            setThreadFocused((prev) => updateThreadNode(prev, uri, finalizeRepost));
            setThreadAncestors((prev) => updateThreadNode(prev, uri, finalizeRepost));
            setThreadReplies((prev) => updateThreadNode(prev, uri, finalizeRepost));
          } else {
            setPosts((prev) =>
                prev.map((item) =>
                    item.post.uri === uri ? finalizeRepost(item) : item
                )
            );
          }
        }
      } catch (e) {
        console.error("Repost failed, reverting", e);
        mode === 'thread' ? fetchThread() : fetchFeed();
      }
    },


    createPost: async (text: string, images: any[] = [], quoteUri?: string, quoteCid?: string, replyParentUri?: string, replyParentCid?: string, replyRootUri?: string, replyRootCid?: string) => {
      if (!agent) return;      
      setPosting(true);
      try {

        const uploadedBlobs: any[] = [];

        if (images.length > 0) {
          for (const img of images.slice(0, 4)) {
            const rawBlob = coerceToBlob(img);

            if (!rawBlob) {
              console.warn("Skipping image: not convertible to Blob/File", img);
              continue;
            }

            console.log("rawBlob", rawBlob.type, rawBlob.size);

            const compressed = await compressImage(rawBlob);

            if (!compressed || compressed.size === 0) {
              console.warn("Skipping image: compression produced empty blob", {
                rawType: rawBlob.type,
                rawSize: rawBlob.size,
              });
              continue;
            }

            const encoding = compressed.type || "image/jpeg";
            const { data } = await agent.uploadBlob(compressed, { encoding });

            uploadedBlobs.push({ blob: data.blob, alt: "" });
          }
        }
        
        const embed = createEmbed(uploadedBlobs, quoteUri, quoteCid);
        const record: any = {
          $type: "app.bsky.feed.post",
          text: text.trim(),
          createdAt: new Date().toISOString(),
          embed: embed
        };

        if (replyParentUri && replyParentCid) {
          record.reply = {
            root: { uri: replyRootUri || replyParentUri, cid: replyRootCid || replyParentCid },
            parent: { uri: replyParentUri, cid: replyParentCid },
          };
        }

        await agent.post(record);

        // Refresh view
        mode === 'thread' ? fetchThread() : fetchFeed();
      } catch(e: any) {
        setPostError(e.message);
      } finally {
        setPosting(false);
      }
    }
  }));

  return (
      <DataProvider
          name="bskyData"
          data={{
            posts, // For Timeline/Feed/Search/Author
            loading,
            error,
            isLoggedIn,
            currentUser,
            savedFeeds,

            // THREAD SPECIFIC DATA
            threadAncestors,
            threadFocused,
            threadReplies,

            threadLoading,
            threadError,

            // Actions status
            posting,
            postError,
          }}
      >
        {children}
      </DataProvider>
  );
});