import { initPlasmicLoader } from "@plasmicapp/loader-nextjs";

export const PLASMIC = initPlasmicLoader({
  projects: [
    {
      id: "tmEX5vHKfKXuU2AsyC4mA6",
      token: "4sbixhxKYcLTlwu8uCycMHW8seZlUEBFpIKd1GdX8g2HOVNreoGMDBjVZBO5n1z0ccPvf07A0762xkrT6RQ",
    },
  ],

  // By default Plasmic will use the last published version of your project.
  // For development, you can set preview to true, which will use the unpublished
  // project, allowing you to see your designs without publishing.  Please
  // only use this for development, as this is significantly slower.
  preview: process.env.NODE_ENV !== 'production',
});

// You can register any code components that you want to use here; see
// https://docs.plasmic.app/learn/code-components-ref/
// And configure your Plasmic project to use the host url pointing at
// the /plasmic-host page of your nextjs app (for example,
// http://localhost:3000/plasmic-host).  See
// https://docs.plasmic.app/learn/app-hosting/#set-a-plasmic-project-to-use-your-app-host

// PLASMIC.registerComponent(...);

import { TestPlasmicComponent } from "./components/Test";

PLASMIC.registerComponent(TestPlasmicComponent, {
  name: "Test Plasmic Component",
  props: {
    message: {
      type: "string",
      defaultValue: "Hello from Test Component!",
    },
    className: "string",
  },
});

import { SevenSegmentClock } from "./components/SevenSegmentClock";

PLASMIC.registerComponent(SevenSegmentClock, {
  name: "SevenSegmentClock",
  props: {
    className: "string",

    clockFontFamily: {
      type: "string",
      defaultValue: "monospace",
      description: "Font family for the main clock digits (hours and minutes)",
    },

    ampmFontFamily: {
      type: "string",
      defaultValue: "sans-serif",
      description: "Font family for the AM / PM indicator",
    },
  },
});

///---------------------------
/// RICH TEXT HANDLER
///---------------------------
import { BlueskyRichText } from "./components/BlueskyRichText";

PLASMIC.registerComponent(BlueskyRichText, {
  name: 'BlueskyRichText',
  props: {
    record: {
      type: 'object',
      defaultValue: { text: "Hello #world https://bsky.app" }
    },
    onTagClick: {
      type: 'eventHandler',
      argTypes: [{ name: 'tag', type: 'string' }]
    },
    fontSize: {
      type: 'number',
    },
  },
});

import { BlueskyFeedProvider } from "./components/BlueskyFeedProvider";

PLASMIC.registerComponent(BlueskyFeedProvider, {
  name: 'BlueskyFeedProvider',
  props: {
    // 1. Mode Selection
    mode: {
      type: 'choice',
      options: [
        { label: 'User Profile', value: 'author' },
        { label: 'Specific Feed (URL)', value: 'feed' },
        { label: 'Search Query', value: 'search' },
        { label: 'My Timeline (Following)', value: 'timeline' },
      ],
      defaultValue: 'author'
    },

    // 2. Conditional Inputs
    actor: {
      type: 'string',
      defaultValue: 'bsky.app',
      description: 'Handle (required for User Profile mode)',
      hidden: (props) => props.mode !== 'author'
    },
    feedUrl: {
      type: 'string',
      description: 'Full URL or at:// URI. Leave empty for Discover.',
      hidden: (props) => props.mode !== 'feed'
    },
    searchQuery: {
      type: 'string',
      defaultValue: 'Plasmic',
      description: 'Search terms',
      hidden: (props) => props.mode !== 'search'
    },

    limit: { type: 'number', defaultValue: 20 },

    // Auth props
    identifier: { type: 'string', description: 'For Login' },
    appPassword: { type: 'string', description: 'For Login' },

    children: 'slot',
  },
  providesData: true,
  refActions: {
    login: {
      description: 'Login',
      argTypes: []
    },
    logout: {
      description: 'Logout',
      argTypes: []
    },
    likePost: {
      description: 'Like a post',
      argTypes: [
        { name: 'uri', type: 'string' },
        { name: 'cid', type: 'string' }
      ]
    },
    repostPost: {
      description: 'Repost a post',
      argTypes: [
        { name: 'uri', type: 'string' },
        { name: 'cid', type: 'string' }
      ]
    },
    fetchPostLikes: {
      description: 'Fetch users who liked a post',
      argTypes: [
        { name: 'uri', type: 'string' },
        {
          name: 'maxLikers',
          type: 'number',
          defaultValue: 10,
          description: 'Maximum number of likers to fetch (prevents crashes!)'
        }
      ]
    },

    createPost: {
      description: "Create a new post (text, images, reply, or quote)",
      argTypes: [
        { name: "text", type: "string", displayName: "Text Content" },

        // Updated to accept the array of image objects
        {
          name: "images",
          type: "object",
          displayName: "Images",
          description: "Array of { file: File, alt?: string }"
        },

        // Quote embed
        { name: "quoteUri", type: "string", displayName: "Quote URI" },
        { name: "quoteCid", type: "string", displayName: "Quote CID" },

        // Reply threading
        { name: "replyParentUri", type: "string", displayName: "Reply Parent URI" },
        { name: "replyParentCid", type: "string", displayName: "Reply Parent CID" },
        { name: "replyRootUri", type: "string", displayName: "Reply Root URI" },
        { name: "replyRootCid", type: "string", displayName: "Reply Root CID" },
      ]
    }
  },
});

import { BlueskyVideo } from "./components/BlueskyVideo";

PLASMIC.registerComponent(BlueskyVideo, {
  name: 'BlueskyVideo',
  props: {
    playlistUrl: 'string',
    thumbnail: 'string',
  },
  importPath: './components/BlueskyVideo',
});



import { ContentEditableTextarea } from "./components/ContentEditableTextarea";

PLASMIC.registerComponent(ContentEditableTextarea, {
  name: "ContentEditableTextarea",
  props: {
    value: {
      type: "string",
      defaultValue: "",
    },
    defaultValue: {
      type: "string",
      defaultValue: "",
    },
    placeholder: {
      type: "string",
      defaultValue: "Type here…",
    },
    disabled: {
      type: "boolean",
      defaultValue: false,
    },
    multiline: {
      type: "boolean",
      defaultValue: true,
    },
    name: {
      type: "string",
      description: "Optional: form field name",
    },

    onChange: {
      type: "eventHandler",
      argTypes: [{ name: "text", type: "string" }],
    },

    onFocus: {
      type: "eventHandler",
      argTypes: [],
    },
    onBlur: {
      type: "eventHandler",
      argTypes: [],
    },
  },
  importPath: "./components/ContentEditableTextarea",

  refActions: {
    clearText: {
      description: "Reset the text to empty",
      argTypes: [],
    },
    // Optional extras; handy in Studio
    setText: {
      description: "Programmatically set the text",
      argTypes: [{ name: "text", type: "string" }],
    },
    focus: {
      description: "Focus the field",
      argTypes: [],
    },
    blur: {
      description: "Blur the field",
      argTypes: [],
    },
  },
});



