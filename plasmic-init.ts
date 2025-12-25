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

    // 2. Conditional Inputs (Use descriptions to guide usage)
    actor: {
      type: 'string',
      defaultValue: 'bsky.app',
      description: 'Handle (required for User Profile mode)',
      hidden: (props) => props.mode !== 'author'
    },
    feedUrl: {
      type: 'string',
      description: 'Full URL (e.g. https://bsky.app/profile/.../feed/...) or at:// URI. Leave empty for Discover.',
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
    login: { description: 'Login',
      //needs argtypes to be added in element actions in plasmic editor
      argTypes: []},
    likePost: {
      description: 'Like a post',
      argTypes: [
        { name: 'uri', type: 'string' },
        { name: 'cid', type: 'string' }
      ]
    }
  }
});
    

