// ==UserScript==
// @name         X → 飞书云文档外观
// @namespace    local.x-feishu-docs
// @version      1.5.4
// @description  将 X 时间线、用户主页和帖子讨论显示为飞书云文档风格，保留原文、媒体与原生操作。
// @author       KAMIENDER
// @homepageURL  https://github.com/KAMIENDER/x-feishu-docs
// @supportURL   https://github.com/KAMIENDER/x-feishu-docs/issues
// @downloadURL  https://raw.githubusercontent.com/KAMIENDER/x-feishu-docs/main/x-feishu-docs.user.js
// @updateURL    https://raw.githubusercontent.com/KAMIENDER/x-feishu-docs/main/x-feishu-docs.meta.js
// @match        https://x.com/*
// @match        https://www.x.com/*
// @match        https://twitter.com/*
// @match        https://www.twitter.com/*
// @match        https://mobile.twitter.com/*
// @run-at       document-start
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  // 可直接改这两项；不依赖飞书账号，也不会向飞书发送数据。
  const BRAND = '飞书云文档';
  const MAX_POSTS = 400;
  const LOAD_BATCH_SIZE = 20;
  const HOST_ID = 'x-feishu-docs-shell';
  const CLASS_NAME = 'x-feishu-docs-active';
  const STORE = 'x-feishu-docs:';
  // 认证页面必须保留原始表单；登录完成后再自动恢复文档外观。
  const activeMode = () => state.enabled
    && !/^\/(?:login(?:\/|$)|i\/(?:jf\/onboarding|flow\/(?:login|signup|onboarding)))/.test(location.pathname)
    // 直接打开或刷新 X 的编辑器、媒体深链接时保留原生界面；通过文档操作打开的浮层继续覆盖在文档上。
    && (state.nativeUI || !/^\/compose\/|\/status\/\d+\/(?:photo|video)\/\d+\/?$/.test(location.pathname));
  const SELECTORS = {
    posts: 'article[data-testid="tweet"], article[role="article"]',
    text: '[data-testid="tweetText"]',
    author: '[data-testid="User-Name"]',
    profile: 'a[data-testid="AppTabBar_Profile_Link"]',
  };
  const load = (key, fallback) => {
    try { return GM_getValue(STORE + key, fallback); } catch { return fallback; }
  };
  const save = (key, value) => {
    try { GM_setValue(STORE + key, value); } catch { /* 存储不可用时仍可阅读。 */ }
  };
  const savedIds = load('favorites', []);
  const savedNotes = load('notes', []);
  const state = {
    enabled: load('enabled', true),
    privacy: load('privacy', false) === true, revealedMedia: new Set(),
    favorites: new Set(Array.isArray(savedIds) ? savedIds : []),
    notes: Array.isArray(savedNotes) ? savedNotes : [],
    posts: new Map(), query: '', filter: 'all', reader: null, conversation: null,
    ownHandle: '', profile: null, profileKey: '', sequence: 0, loading: false, lastLoad: 0, loadStart: 0,
    nativeUI: false, nativeOpened: false, nativeUntil: 0,
    route: location.pathname + location.search, autoOpened: false,
    routeViews: new Map(), restoredList: false, navigating: false,
  };
  let host, shadow, scanTimer, observer, noteTimer, toastTimer;
  let originalTitle = document.title;
  const originalIcons = new Map();
  const inertRoots = new Map();
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  // 复用本机 Lark 应用内置图标库的原始 SVG，静态内嵌，不加载外部素材。
  const ASSETS = {
  "home": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M9.5 22a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1H20a2 2 0 0 0 2-2V10a2 2 0 0 0-.75-1.562l-8-5.938a2 2 0 0 0-2.5 0l-8 5.938A2 2 0 0 0 2 10v10a2 2 0 0 0 2 2h5.5Z\" fill=\"currentColor\"/></svg>",
  "drive": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"m8.895 22.803-6.55-2.967a1 1 0 0 1-.579-.906V5.07c0-.381.233-.746.579-.907l6.553-2.967c.282-.133.623-.125.898.021l11.86 6.045c.326.168.54.521.54.888v7.366c0 .359-.206.705-.52.877l-11.863 6.38c-.278.155-.63.167-.918.03Zm-5.128-4.51 4.56 2.036V3.671l-4.56 2.035v12.587Zm6.56 1.921 9.83-5.27.04-.04V8.757l-9.87-5.015v5.684l2.963 1.82L16 9.677c.894-.518 1.953.615 1.297 1.473a1 1 0 0 1-.293.258c-2.224 1.29-4.451 2.575-6.678 3.861v4.945Zm.001-8.526v1.377l1.017-.688-1.017-.689Z\" fill=\"currentColor\"/></svg>",
  "book": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2.5 2.5a1 1 0 0 1 1-1h13a5 5 0 0 1 5 5v15a1 1 0 0 1-1 1h-13a5 5 0 0 1-5-5v-15Zm2 1V7h9a3 3 0 0 1 3 3v10.5h3v-14a3 3 0 0 0-3-3h-12Zm0 9h5a2 2 0 0 1 2 2v6h3V10a1 1 0 0 0-1-1h-9v3.5Zm0 2v3a3 3 0 0 0 3 3h2v-6h-5Z\" fill=\"currentColor\"/></svg>",
  "lines": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M21 18.5a1 1 0 1 1 0 2H3a1 1 0 1 1 0-2h18Zm-3.464-11c.11 0 .2.09.205.2a3.8 3.8 0 0 0 3.595 3.595c.11.006.2.095.2.205 0 .11-.09.2-.2.205A3.8 3.8 0 0 0 17.74 15.3a.209.209 0 0 1-.205.2c-.11 0-.2-.09-.205-.2a3.8 3.8 0 0 0-3.595-3.595.209.209 0 0 1-.2-.205c0-.11.09-.2.2-.205A3.8 3.8 0 0 0 17.331 7.7c.006-.11.095-.2.205-.2Zm-7.126 3a1 1 0 0 1 0 2H3a1 1 0 1 1 0-2h7.41Zm10.479-8c.613 0 1.111.448 1.111 1s-.498 1-1.111 1H3.11C2.498 4.5 2 4.052 2 3.5s.498-1 1.111-1H20.89Z\" fill=\"currentColor\"/></svg>",
  "folder": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M3.5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h17a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2h-6.775a4 4 0 0 1-1.404-.255l-2.642-.99A4 4 0 0 0 8.275 3H3.5Zm17 4v12h-17V7h17Z\" fill=\"currentColor\"/></svg>",
  "search": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M16.473 17.887A9.46 9.46 0 0 1 10.5 20a9.5 9.5 0 1 1 9.5-9.5 9.46 9.46 0 0 1-2.113 5.973l3.773 3.773a.996.996 0 0 1-.007 1.407.996.996 0 0 1-1.407.007l-3.773-3.773ZM18 10.5a7.5 7.5 0 1 0-15 0 7.5 7.5 0 0 0 15 0Z\" fill=\"currentColor\"/></svg>",
  "plus": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 2a1 1 0 0 0-1 1v8H3a1 1 0 1 0 0 2h8v8a1 1 0 1 0 2 0v-8h8a1 1 0 1 0 0-2h-8V3a1 1 0 0 0-1-1Z\" fill=\"currentColor\"/></svg>",
  "upload": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M24 17a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z\" fill=\"#ED6D0C\"/><path d=\"M11.07 21.001H6a6 6 0 0 1-.94-11.927 7.001 7.001 0 0 1 13.877-.02 8 8 0 0 0-7.866 11.947Z\" fill=\"#FF811A\"/><path d=\"m19.488 16.68-.816-.816v3.977a.701.701 0 1 1-1.403 0v-3.917l-.756.757a.701.701 0 1 1-.992-.992l1.983-1.984a.701.701 0 0 1 .992 0l1.984 1.984a.701.701 0 0 1-.992.992Z\" fill=\"#fff\"/></svg>",
  "new": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2.5 2a1 1 0 0 0-1 1v15.059a4.85 4.85 0 0 0 1.504 3.494A5.24 5.24 0 0 0 6.635 23h6.073A8 8 0 0 1 20.5 9.398V6.941a4.85 4.85 0 0 0-1.504-3.494A5.24 5.24 0 0 0 15.365 2H2.5Z\" fill=\"#5083FB\"/><path d=\"M24 17a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z\" fill=\"#1456F0\"/><path d=\"M15 17a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 15 17Z\" fill=\"#fff\"/><path d=\"M18 20a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 1 1.5 0v4.5A.75.75 0 0 1 18 20Z\" fill=\"#fff\"/></svg>",
  "template": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M14.357 13.92a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z\" fill=\"#5B65F5\"/><path d=\"M11.008 3.268a2 2 0 0 1 2.45-1.414l7.702 2.064a2 2 0 0 1 1.414 2.45L20.51 14.07a2 2 0 0 1-2.45 1.414l-7.702-2.064a2 2 0 0 1-1.414-2.45l2.064-7.702Z\" fill=\"#FFC60A\"/><path d=\"M14.248 10.716a1 1 0 0 1 1.732 0l5.769 9.999a1 1 0 0 1-.867 1.5H9.345a1 1 0 0 1-.866-1.5l5.769-9.999Z\" fill=\"#F54A45\"/></svg>",
  "settings": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2 5a1 1 0 0 1 1-1h18a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm10.5 12.105c.202.75.568 1.447 1.072 2.038l1.17-.128a1.083 1.083 0 0 1 1.11.642l.521 1.19c.707.16 1.44.17 2.15.03l.535-1.22a1.082 1.082 0 0 1 1.11-.642l1.285.141a5.254 5.254 0 0 0 1.047-1.927l-.737-1.013a1.084 1.084 0 0 1 0-1.275l.672-.924a5.26 5.26 0 0 0-1.226-1.989l-1.041.114a1.083 1.083 0 0 1-1.11-.642l-.393-.898a5.193 5.193 0 0 0-2.435.035l-.378.863a1.082 1.082 0 0 1-1.11.642l-.929-.101a5.259 5.259 0 0 0-1.253 2.095l.586.805c.277.38.277.895 0 1.275l-.646.889Zm6.75-1.38c0 .966-.776 1.75-1.733 1.75a1.742 1.742 0 0 1-1.732-1.75c0-.967.776-1.75 1.732-1.75a1.74 1.74 0 0 1 1.733 1.75ZM2 12a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm0 7a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Z\" fill=\"currentColor\"/></svg>",
  "chevron": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"m3.414 7.086-.707.707a1 1 0 0 0 0 1.414l7.778 7.778a2 2 0 0 0 2.829 0l7.778-7.778a1 1 0 0 0 0-1.414l-.707-.707a1 1 0 0 0-1.415 0l-7.07 7.07-7.072-7.07a1 1 0 0 0-1.414 0Z\" fill=\"currentColor\"/></svg>",
  "more": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M5.5 11.75a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Zm8.225 0a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Zm8.275 0a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Z\" fill=\"currentColor\"/></svg>",
  "grid": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M18.5 19.75a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Zm-15.5 0a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Zm15.5-15.5a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0ZM3 4.25a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Zm7.25 15a1.75 1.75 0 1 1 3.5 0 1.75 1.75 0 0 1-3.5 0ZM17.5 12a1.75 1.75 0 1 1 3.5 0 1.75 1.75 0 0 1-3.5 0Zm-8 0a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0ZM3 12a1.75 1.75 0 1 1 3.5 0A1.75 1.75 0 0 1 3 12Zm7.25-7.25a1.75 1.75 0 1 1 3.5 0 1.75 1.75 0 0 1-3.5 0Z\" fill=\"currentColor\"/></svg>",
  "back": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M16.293 2.293a1 1 0 0 1 0 1.414L8 12l8.293 8.293a1 1 0 0 1-1.414 1.414l-8.293-8.293a2 2 0 0 1 0-2.828l8.293-8.293a1 1 0 0 1 1.414 0Z\" fill=\"currentColor\"/></svg>",
  "star": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"m12 3.687 2.443 3.783a3 3 0 0 0 1.735 1.268l4.35 1.179-2.842 3.543a3 3 0 0 0-.656 2.03l.232 4.535-4.182-1.613a3 3 0 0 0-2.16 0l-4.182 1.613.232-4.534a3 3 0 0 0-.656-2.03L3.47 9.916l4.35-1.18A3 3 0 0 0 9.557 7.47L12 3.687Zm1.26-1.736a1.5 1.5 0 0 0-2.52 0L7.877 6.385a1 1 0 0 1-.579.422L2.211 8.186a1.5 1.5 0 0 0-.778 2.386l3.32 4.14a1 1 0 0 1 .22.677L4.7 20.692a1.5 1.5 0 0 0 2.038 1.476l4.901-1.89a1 1 0 0 1 .72 0l4.9 1.89a1.5 1.5 0 0 0 2.038-1.476l-.27-5.303a1 1 0 0 1 .218-.677l3.32-4.14a1.5 1.5 0 0 0-.777-2.386L16.7 6.807a1 1 0 0 1-.578-.422L13.26 1.95Z\" fill=\"currentColor\"/></svg>",
  "refresh": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M9.93 4.273a8 8 0 0 1 8.683 3.224h-3.11a1 1 0 0 0 0 2h5.496a1 1 0 0 0 1.001-1V3a1 1 0 1 0-2 0v3a10 10 0 1 0 .66 11 1 1 0 0 0-1.732-1A8 8 0 1 1 9.93 4.273Z\" fill=\"currentColor\"/></svg>",
  "doc": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2.5 2.5a1 1 0 0 1 1-1h12.865a5.24 5.24 0 0 1 3.631 1.447A4.848 4.848 0 0 1 21.5 6.441V21.5a1 1 0 0 1-1 1H7.635a5.24 5.24 0 0 1-3.63-1.447A4.849 4.849 0 0 1 2.5 17.559V2.5Z\" fill=\"#336DF4\"/><path d=\"M7 8.7a.7.7 0 0 1 .7-.7h8.6a.7.7 0 1 1 0 1.4H7.7a.7.7 0 0 1-.7-.7Zm0 3.4a.7.7 0 0 1 .7-.7h8.6a.7.7 0 1 1 0 1.4H7.7a.7.7 0 0 1-.7-.7Zm0 3.4a.7.7 0 0 1 .7-.7h4.6a.7.7 0 1 1 0 1.4H7.7a.7.7 0 0 1-.7-.7Z\" fill=\"#fff\"/></svg>",
  "organization": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M6.304 16.5h11.392c.25-.15.52-.27.804-.355v-2.146a1 1 0 0 0-1-1h-11a1 1 0 0 0-1 1v2.146c.285.085.555.205.804.355ZM3.5 16.145v-2.146a3 3 0 0 1 3-3H11V8.873a4 4 0 1 1 2 0v2.126h4.5a3 3 0 0 1 3 3v2.146a3.5 3.5 0 1 1-2.804.355H6.304a3.5 3.5 0 1 1-2.804-.355ZM12 6.999a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM19.5 21a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-15 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z\" fill=\"currentColor\"/></svg>",
  "light": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"m20.348 9.237.173-.418c.08-.192.187-.369.317-.525A9.05 9.05 0 0 1 21 10.001l-.113 1.357a7.065 7.065 0 0 1-4.807 6.116.17.17 0 0 0-.107.107l-.554 1.663a1.838 1.838 0 0 1-1.744 1.256h-3.35a1.838 1.838 0 0 1-1.744-1.256l-.554-1.663a.17.17 0 0 0-.107-.107 7.065 7.065 0 0 1-4.807-6.116L3 10a9 9 0 0 1 12.06-8.467 2.025 2.025 0 0 1-.97.846l-.423.175a2.747 2.747 0 0 0-.796.5A7 7 0 0 0 5 9.922l.105 1.269a5.065 5.065 0 0 0 3.446 4.384 2.17 2.17 0 0 1 1.372 1.372l.518 1.553h3.117l.517-1.553a2.17 2.17 0 0 1 1.372-1.372 5.066 5.066 0 0 0 3.446-4.384l.042-.508c.6-.257 1.119-.74 1.412-1.447ZM10 21.501a1 1 0 1 0 0 2h4a1 1 0 1 0 0-2h-4Zm7.248-20.109a.6.6 0 0 1 1.125 0l.298.75a3.5 3.5 0 0 0 1.854 1.93l.72.311c.5.217.5.956-.001 1.173l-.72.31a3.501 3.501 0 0 0-1.855 1.933l-.296.746a.6.6 0 0 1-1.126 0l-.297-.75a3.501 3.501 0 0 0-1.857-1.934l-.717-.31c-.501-.216-.501-.956 0-1.172l.72-.311a3.501 3.501 0 0 0 1.855-1.93l.297-.746Z\" fill=\"currentColor\"/></svg>",
  "filter": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M16 11.431V21a1 1 0 1 1-2 0V11c0-.147.032-.287.089-.412a.96.96 0 0 1 .4-.467L20 6.83V4H4v2.866l5.345 3.195A1 1 0 0 1 10 11v6.5a1 1 0 1 1-2 0v-6.035c-.477-.285-3.369-1.867-4.957-2.735A2 2 0 0 1 2 6.975V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2.945a2 2 0 0 1-1.035 1.752L16 11.43Z\" fill=\"currentColor\"/></svg>",
  "list": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M3 3a1 1 0 0 0 0 2h2a1 1 0 0 0 0-2H3Zm7 0a1 1 0 0 0 0 2h11a1 1 0 1 0 0-2H10Zm-1 9a1 1 0 0 1 1-1h11a1 1 0 1 1 0 2H10a1 1 0 0 1-1-1Zm-6-1a1 1 0 1 0 0 2h2a1 1 0 1 0 0-2H3Zm6 9a1 1 0 0 1 1-1h11a1 1 0 1 1 0 2H10a1 1 0 0 1-1-1Zm-6-1a1 1 0 1 0 0 2h2a1 1 0 1 0 0-2H3Z\" fill=\"currentColor\"/></svg>",
  "tiles": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M23 5a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5ZM3 13h8v6H3v-6Zm0-2V5h8v6H3Zm10 2h8v6h-8v-6Zm8-2h-8V5h8v6Z\" fill=\"currentColor\"/></svg>",
  "collapse": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M22 4a1 1 0 0 0-1-1H3a1 1 0 0 0 0 2h18a1 1 0 0 0 1-1Zm-1.111 7c.614 0 1.111.448 1.111 1s-.497 1-1.111 1H13.11c-.613 0-1.11-.448-1.11-1s.498-1 1.111-1h7.778ZM22 20c0-.552-.497-1-1.111-1H13.11c-.614 0-1.111.448-1.111 1s.498 1 1.111 1h7.778c.614 0 1.111-.448 1.111-1ZM8.59 16.864a1.117 1.117 0 0 0 0-1.729l-4.95-3.916c-.676-.535-1.64-.027-1.64.864v7.834c0 .89.964 1.4 1.639.865l4.951-3.918Z\" fill=\"currentColor\"/></svg>",
  "disk": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M11.442 16.2a.375.375 0 0 0-.375.375v1.583c0 .207.168.375.375.375h1.583a.375.375 0 0 0 .375-.375v-1.583a.375.375 0 0 0-.375-.375h-1.583Zm3.825.375c0-.207.168-.375.375-.375h1.583c.207 0 .375.168.375.375v1.583a.375.375 0 0 1-.375.375h-1.583a.375.375 0 0 1-.375-.375v-1.583Z\" fill=\"currentColor\"/><path d=\"M17.799 2.667H6.2a.933.933 0 0 0-.907.713l-2.6 10.733a.934.934 0 0 0-.026.255V20.4c0 .515.418.933.933.933h16.8a.933.933 0 0 0 .933-.933v-6.067a.93.93 0 0 0-.057-.323l-2.57-10.629a.933.933 0 0 0-.907-.714Zm1.258 10.701H4.937l2.104-8.741h9.917l2.099 8.741ZM4.667 19.43v-4.125h14.667v4.125H4.667Z\" fill=\"currentColor\"/></svg>",
  "lock": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M15 15a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm-2 0a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z\" fill=\"currentColor\"/><path d=\"M6.5 7.5V8H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2.5v-.5a5.5 5.5 0 1 0-11 0Zm9 .5h-7v-.5a3.5 3.5 0 1 1 7 0V8ZM4 10h16v10H4V10Z\" fill=\"currentColor\"/></svg>",
  "trash": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M8 4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2h5a1 1 0 1 1 0 2h-1v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6H3a1 1 0 0 1 0-2h5ZM6 6v14h12V6H6Zm4 3a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z\" fill=\"currentColor\"/></svg>",
  "logo": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"m12.924 12.803.056-.054c.038-.034.076-.072.11-.11l.077-.076.23-.227 1.334-1.319.335-.331c.063-.063.13-.123.195-.183a7.777 7.777 0 0 1 1.823-1.24 7.607 7.607 0 0 1 1.014-.4 13.177 13.177 0 0 0-2.5-5.013 1.203 1.203 0 0 0-.94-.448h-9.65c-.173 0-.246.224-.107.325a28.23 28.23 0 0 1 8 9.098c.007-.006.016-.013.023-.022Z\" fill=\"#00D6B9\"/><path d=\"M9.097 21.299a13.258 13.258 0 0 0 11.82-7.247 5.576 5.576 0 0 1-.731 1.076 5.315 5.315 0 0 1-.745.7 5.117 5.117 0 0 1-.615.404 4.626 4.626 0 0 1-.726.331 5.312 5.312 0 0 1-1.883.312 5.892 5.892 0 0 1-.524-.031 6.509 6.509 0 0 1-.729-.126c-.06-.016-.12-.029-.18-.044-.166-.044-.33-.092-.494-.14-.082-.024-.164-.046-.246-.072-.123-.038-.247-.072-.366-.11l-.3-.095-.284-.094-.192-.067c-.08-.025-.155-.053-.234-.082a3.49 3.49 0 0 1-.167-.06c-.11-.04-.221-.079-.328-.12-.063-.025-.126-.047-.19-.072l-.252-.098c-.088-.035-.18-.07-.268-.107l-.174-.07c-.072-.028-.141-.06-.214-.088l-.164-.07c-.057-.024-.114-.05-.17-.075l-.149-.066-.135-.06-.14-.063a90.183 90.183 0 0 1-.141-.066 4.808 4.808 0 0 0-.18-.083c-.063-.028-.123-.06-.186-.088a5.697 5.697 0 0 1-.199-.098 27.762 27.762 0 0 1-8.067-5.969.18.18 0 0 0-.312.123l.006 9.21c0 .4.199.779.533 1a13.177 13.177 0 0 0 7.326 2.205Z\" fill=\"#3370FF\"/><path d=\"M23.732 9.295a7.55 7.55 0 0 0-3.35-.776 7.521 7.521 0 0 0-2.284.35c-.054.016-.107.035-.158.05a8.297 8.297 0 0 0-.855.35 7.14 7.14 0 0 0-.552.297 6.716 6.716 0 0 0-.533.347c-.123.089-.243.18-.363.275-.13.104-.252.211-.375.321-.067.06-.13.123-.196.184l-.334.328-1.338 1.321-.23.228-.076.075c-.038.038-.076.073-.11.11l-.057.054a1.914 1.914 0 0 1-.085.08c-.032.028-.063.06-.095.088a13.286 13.286 0 0 1-2.748 1.946c.06.028.12.057.18.082l.142.066c.044.022.091.041.139.063l.135.06.149.067.17.075.164.07c.073.031.142.06.215.088.056.025.116.047.173.07.088.034.177.072.268.107.085.031.168.066.253.098l.189.072c.11.041.218.082.328.12.057.019.11.041.167.06.08.028.155.053.234.082l.192.066.284.095.3.095c.123.037.243.075.366.11l.246.072c.164.048.331.095.495.14.06.015.12.03.18.043.114.029.227.05.34.07.13.022.26.04.389.057a5.815 5.815 0 0 0 .994.019 5.172 5.172 0 0 0 1.413-.3 5.405 5.405 0 0 0 .726-.334c.06-.035.122-.07.182-.108a7.96 7.96 0 0 0 .432-.297 5.362 5.362 0 0 0 .577-.517 5.285 5.285 0 0 0 .37-.429 5.797 5.797 0 0 0 .527-.827l.13-.258 1.166-2.325-.003.006a7.391 7.391 0 0 1 1.527-2.186Z\" fill=\"#133C9A\"/></svg>",
  "note-doc": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M16.716 14.36a.783.783 0 0 1 0 1.565H7.282a.783.783 0 0 1 0-1.565h9.434Zm-5.001-4.229a.8.8 0 0 1 0 1.6h-4.4a.8.8 0 0 1 0-1.6h4.4Z\" fill=\"currentColor\"/><path d=\"M15.153 1.5c.75.006 1.472.36 2.02.874l3.875 3.63c.607.569.952 1.366.952 2.198v8.28c0 3.323-2.687 6.017-6 6.017H8c-3.313 0-6-2.694-6-6.016v-8.97C2 4.17 4.72 1.469 8.056 1.5h7.097ZM8.037 3.503A4.006 4.006 0 0 0 4 7.514v8.969a4.006 4.006 0 0 0 4 4.01h8c2.209 0 4-1.796 4-4.01v-8.28c0-.083-.012-.164-.031-.243h-2.42l-.203-.01a2.005 2.005 0 0 1-1.796-1.996V3.666c0-.137-.152-.16-.29-.162H8.038Z\" fill=\"currentColor\"/></svg>"
};
  const icon = name => (ASSETS[name] || ASSETS.doc).replace('<svg ', '<svg class="icon" aria-hidden="true" ');
  const logo = ASSETS.logo.replace('<svg ', '<svg class="brand-logo" aria-hidden="true" ');
  const favicon = 'data:image/svg+xml,' + encodeURIComponent(ASSETS.logo);
  const $ = selector => shadow.querySelector(selector);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const formatDate = value => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
  };
  // 标题直接来自已加载正文，不生成与内容无关的占位名。
  const headlineOf = record => record.kind === 'note' ? record.title
    : record.text.split(/\r?\n/).map(line => line.trim()).find(Boolean) || `${record.author}的附件资料`;
  const titleOf = record => {
    if (record.kind === 'note') return record.title;
    const chars = Array.from(headlineOf(record).replace(/\s+/g, ' '));
    return chars.length > 70 ? chars.slice(0, 70).join('') + '…' : chars.join('');
  };

  // 保留 X 原来的布局和滚动范围，不能 display:none，否则虚拟时间线可能停止加载。
  // 原生弹窗保留在 X 的 DOM 中。X 的多个祖先有 z-index:0，须抬高 react-root 才能越过外观层。
  GM_addStyle(`html.${CLASS_NAME}{scrollbar-width:none!important;background:#fff!important}html.${CLASS_NAME}::-webkit-scrollbar{display:none!important}html.${CLASS_NAME} body>:not(#${HOST_ID}){visibility:hidden!important;pointer-events:none!important}#${HOST_ID}{position:fixed!important;inset:0!important;z-index:2147483646!important;display:block!important;opacity:1!important;pointer-events:auto!important}#${HOST_ID}[hidden]{display:none!important}html.${CLASS_NAME}.xdocs-native-ui #react-root{position:relative!important;z-index:2147483647!important}html.${CLASS_NAME}.xdocs-native-ui #layers{position:relative!important;z-index:2147483647!important}html.${CLASS_NAME}.xdocs-native-ui #layers,html.${CLASS_NAME}.xdocs-native-ui #layers *{visibility:visible!important;pointer-events:auto!important}html.${CLASS_NAME}.xdocs-native-ui .xdocs-media-ancestor{transform:none!important;filter:none!important;perspective:none!important;contain:none!important}html.${CLASS_NAME}.xdocs-native-ui .xdocs-native-media{position:fixed!important;inset:12vh 15vw!important;width:70vw!important;height:76vh!important;max-height:76vh!important;background:#000!important}html.${CLASS_NAME}.xdocs-native-ui .xdocs-native-media video{width:100%!important;height:100%!important;object-fit:contain!important}html.${CLASS_NAME}.xdocs-native-ui .xdocs-native-surface{z-index:2147483647!important}html.${CLASS_NAME}.xdocs-native-ui .xdocs-native-surface,html.${CLASS_NAME}.xdocs-native-ui .xdocs-native-surface *{visibility:visible!important;pointer-events:auto!important}html.${CLASS_NAME}.xdocs-native-ui #layers [role="dialog"],html.${CLASS_NAME}.xdocs-native-ui #layers [role="dialog"] *,html.${CLASS_NAME}.xdocs-native-ui #layers [role="menu"],html.${CLASS_NAME}.xdocs-native-ui #layers [role="menu"] *{visibility:visible!important;pointer-events:auto!important}`);
  if (activeMode()) document.documentElement.classList.add(CLASS_NAME);
  // 原生回复浮层也可能带有媒体。遮住整个照片/播放器区域，避免封面背景或控件漏出内容。
  GM_addStyle(`html.xdocs-privacy :is(#react-root,#layers) :is(img,video,[data-testid="tweetPhoto"],[data-testid="videoPlayer"]){filter:blur(32px)!important;opacity:0!important}html.xdocs-privacy :is(#react-root,#layers) [data-xdocs-privacy-revealed],html.xdocs-privacy :is(#react-root,#layers) [data-xdocs-privacy-revealed] :is(img,video,[data-testid="tweetPhoto"],[data-testid="videoPlayer"]){filter:none!important;opacity:1!important}`);
  if (activeMode() && state.privacy) document.documentElement.classList.add('xdocs-privacy');

  const css = `
    :host{all:initial;color:#1f2329;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color-scheme:light}
    *{box-sizing:border-box}button,input,textarea{font:inherit}button{cursor:pointer;color:inherit;border:0;background:transparent}button,a,input,textarea{outline-offset:3px}button:focus-visible,a:focus-visible{outline:2px solid #3370ff}a{color:inherit;text-decoration:none}[hidden]{display:none!important}
    .icon{width:18px;height:18px;flex:none;vertical-align:middle}
    /* 只保留文档导航侧栏，页面区域不再绘制额外应用栏。 */
    .app{position:absolute;inset:0;display:grid;grid-template-columns:268px minmax(0,1fr);background:#fff}
    .sidebar{background:#f5f6f7;border-right:1px solid #eff0f1;padding:0 8px;display:flex;flex-direction:column;min-height:0}
    .brand{display:flex;gap:8px;align-items:center;height:60px;flex:none;padding:0 12px;font-size:16px;font-weight:500;white-space:nowrap}
    .brand-logo{width:24px;height:24px;flex:none}.brand-toggle{width:20px;height:24px;padding:0;color:#646a73;display:grid;place-items:center}.brand-toggle .icon{width:16px;height:16px}
    .search-box{margin:1px 0 7px;position:relative}.search-box>.icon{position:absolute;left:12px;top:9px;color:#8f959e;width:16px;height:16px}.search-box input{border:0;width:100%;height:32px;background:#fff;border-radius:6px;padding:0 12px 0 34px;color:#1f2329}.search-box input::placeholder{color:#8f959e}
    .nav{display:flex;flex-direction:column;gap:0}.nav-item{display:flex;gap:8px;align-items:center;height:36px;border-radius:6px;padding:0 12px;text-align:left;font-size:14px}.nav-item:hover{background:#e9edf2}.nav-item.active{background:#dce6fc;color:#245bdb;font-weight:500}.nav-item>.icon{width:18px;height:18px;color:#646a73}.nav-item.active>.icon{color:#245bdb}
    .section-label{display:flex;align-items:center;justify-content:space-between;margin:22px 12px 8px;height:18px;color:#646a73;font-size:12px;font-weight:400}.side-note{display:flex;align-items:center;gap:8px;width:100%;text-align:left;height:34px;padding:0 12px;border-radius:5px}.side-note:hover{background:#e9edf2}.side-note span{display:block;min-width:0;max-height:21px;line-height:21px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.side-note>.icon{width:16px;height:16px;color:#8f959e}.side-quiet{font-size:12px;color:#8f959e;padding:4px 12px}
    .side-bottom{margin-top:auto;border-top:1px solid #dee0e3;padding:10px 0;display:flex;justify-content:space-around;color:#8f959e}.side-bottom .icon-btn+.icon-btn{border-left:1px solid #dee0e3;border-radius:0}.side-bottom .icon-btn{flex:1;height:20px}
    .icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:4px;color:#8f959e;padding:4px}.icon-btn:hover{background:#eff0f1}
    .main{display:flex;flex-direction:column;min-width:0;min-height:0}.topbar{height:64px;flex:none;padding:0 24px;display:flex;align-items:center;justify-content:space-between}.page-title{font-size:20px;font-weight:500;margin:0}.top-tools{display:flex;align-items:center;gap:10px}.top-tools .icon{width:20px;height:20px}.avatar{height:32px;width:32px;background:#d64b9e;color:#fff;display:grid;place-items:center;font-size:12px;border-radius:50%;margin-left:4px}.page-heading{display:flex;align-items:center;gap:10px}.restore-sidebar{display:none}.app.collapsed{grid-template-columns:minmax(0,1fr)}.app.collapsed>.sidebar{display:none}.app.collapsed .restore-sidebar{display:inline-flex}
    .scroll{overflow:auto;flex:1;min-height:0;padding:0 24px 24px;overscroll-behavior:contain;background:#fff}
    .actions{display:flex;gap:12px;padding:6px 0 24px;max-width:860px}.action-card{border:1px solid #dee0e3;border-radius:8px;display:flex;align-items:center;gap:12px;height:64px;padding:0 16px;flex:1;min-width:0;text-align:left}.action-card:hover{background:#f8faff;border-color:#b4c7f5}.action-card>.icon{width:24px;height:24px}.card-text{flex:1;min-width:0}.card-text strong{display:block;font-size:14px;font-weight:500}.card-text small{font-size:12px;color:#8f959e;display:block;line-height:20px}.action-card>.chevron{width:12px;color:#646a73}.action-card>.chevron .icon{width:12px;height:12px}
    .list-tools{display:flex;align-items:center;justify-content:space-between;gap:14px;height:48px;min-height:48px}.tabs{display:flex;align-items:center;gap:28px}.tab{padding:8px 0;color:#646a73;white-space:nowrap;font-size:16px}.tab.active{color:#3370ff;font-weight:500}.view-tools{display:flex;gap:12px;align-items:center;color:#646a73;font-size:12px}.view-tools button{display:flex;gap:6px;align-items:center;border-radius:4px;padding:4px}.view-tools button:hover{background:#f5f6f7}.view-tools .icon{width:16px;height:16px}.view-switch{display:flex;gap:0;background:#f5f6f7;padding:2px;border-radius:6px}.view-switch button{width:26px;height:24px;justify-content:center;padding:4px}.view-switch .active{color:#3370ff;background:#fff}
    .table{width:100%;border-collapse:collapse;table-layout:fixed}.table th{font-weight:400;color:#646a73;text-align:left;height:32px;font-size:14px;border-bottom:1px solid #dee0e3;padding:0 8px}.table th:first-child{padding-left:4px;width:40%}.table th:nth-child(2){width:14%}.table th:nth-child(3){width:14%}.table th:nth-child(4){width:15%}.table th:nth-child(5){width:14%}.table th:last-child{width:36px}.table td{height:56px;border-bottom:1px solid #dee0e3;padding:0 8px;color:#8f959e;font-size:14px}.table tr:hover td{background:#f5f6f7}.row-title{width:100%;display:flex;align-items:center;gap:12px;text-align:left;color:#1f2329;padding:12px 0;font-size:14px;min-height:55px}.row-title>.icon{width:24px;height:24px}.row-title span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.owner,.location{display:flex;align-items:center;gap:8px;overflow:hidden;white-space:nowrap}.owner span:last-child,.location span{overflow:hidden;text-overflow:ellipsis}.owner-dot img{width:100%;height:100%;object-fit:cover;border-radius:50%}.owner-dot{overflow:hidden;display:grid;place-items:center;width:20px;height:20px;flex:none;border-radius:50%;font-size:10px;background:#e6edff;color:#5b75b6}.location>.icon{width:16px;height:16px;color:#8f959e}.favorite.active{color:#d19b30}.favorite.active svg{fill:#fff1b6}.row-menu>.icon{width:16px;height:16px}
    .table.grid tbody{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;padding:16px 0}.table.grid thead{display:none}.table.grid tbody tr{display:flex;flex-direction:column;border:1px solid #dee0e3;border-radius:8px;padding:12px;min-width:0;position:relative}.table.grid td{display:block;border:0;height:auto;padding:4px}.table.grid td:first-child{padding-right:20px}.table.grid .row-title{padding:0;gap:10px;min-height:44px}.table.grid td:nth-child(4),.table.grid td:nth-child(5){display:none}.table.grid td:last-child{position:absolute;right:4px;top:10px}.table.grid .owner{padding-left:32px}
    .empty{text-align:center;padding:60px 20px;color:#8f959e}.empty p{margin:12px 0}.empty button,.load-more{border:1px solid #dee0e3;border-radius:6px;padding:7px 16px;color:#646a73;background:#fff}.empty button:hover,.load-more:hover{background:#f5f8ff}.footer{text-align:center;padding:20px 0 5px}.footer small{display:block;margin-top:8px;color:#8f959e;font-size:11px}
    .reader-toolbar{border-top:1px solid #f1f2f4;border-bottom:1px solid #e5e7eb;padding:9px 28px;display:flex;justify-content:space-between;align-items:center;gap:12px;color:#7c838f;font-size:12px}.reader-toolbar button{display:inline-flex;gap:5px;align-items:center;padding:5px 8px;border-radius:5px}.reader-toolbar button:hover{background:#f1f3f6}.reader-scroll{flex:1;min-height:0;overflow:auto;background:#fff}.paper{max-width:870px;margin:0 auto;padding:64px 52px 100px}.paper h1{font-size:29px;line-height:1.45;margin:0 0 22px;color:#20242c;font-weight:600;overflow-wrap:anywhere}.metadata{display:flex;gap:16px;color:#949aa3;font-size:12px;padding-bottom:28px;border-bottom:1px solid #edf0f2;margin-bottom:31px;flex-wrap:wrap}.body-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:1.9;color:#373d47;min-height:120px}.attachments{color:#949aa3;border:1px solid #e7e9ed;border-radius:6px;padding:12px 15px;margin-top:30px;font-size:12px;background:#fafbfc}.note-title{width:100%;font-size:29px;font-weight:600;border:0;margin-bottom:14px;color:#20242c;background:#fff}.note-body{width:100%;min-height:50vh;resize:vertical;line-height:1.9;border:0;background:#fff;color:#373d47;font-size:16px}.popover{position:absolute;right:28px;top:58px;width:286px;background:#fff;border:1px solid #e5e7eb;box-shadow:0 8px 32px #1f29401c;border-radius:9px;z-index:5;padding:15px}.popover strong{display:block;margin-bottom:13px;font-weight:600}.popover label{display:flex;gap:9px;align-items:center;padding:8px 0}.popover p{font-size:12px;color:#9298a1;margin:10px 0}.popover button{display:block;text-align:left;width:100%;padding:8px;border-radius:5px}.popover button:hover{background:#f3f5f9}.popover hr{border:0;border-top:1px solid #eef0f3;margin:9px 0}.toast{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 18px;background:#fff;border:1px solid #e6e8ed;border-radius:7px;box-shadow:0 5px 24px #0002;z-index:9;font-size:13px;max-width:85%;text-align:center}

    .body-text a{color:#3370ff;text-decoration:underline;text-underline-offset:3px}.reader-media{margin:24px 0}.reader-media img,.reader-media video{display:block;width:auto;max-width:100%;max-height:70vh;border-radius:6px;margin:0 auto;object-fit:contain}.reader-media button{display:block;width:100%;padding:0}.reader-media figcaption{font-size:12px;color:#8f959e;margin-top:8px}.post-actions{display:flex;flex-wrap:wrap;gap:10px;border-top:1px solid #dee0e3;margin-top:32px;padding-top:16px}.post-actions button{border:1px solid #dee0e3;border-radius:6px;padding:6px 12px;font-size:13px}.post-actions button:hover{background:#f5f6f7}.post-actions button[aria-pressed="true"]{color:#3370ff;border-color:#b4c7f5;background:#f0f4ff}.popover .native-action{display:flex;justify-content:space-between;gap:12px}.popover .native-action small{color:#8f959e}

    .comments{margin-top:40px;padding-top:24px;border-top:1px solid #dee0e3}.comments-heading{display:flex;align-items:baseline;gap:12px;margin-bottom:8px}.comments-heading h2{font-size:18px;font-weight:500;margin:0}.comments-status,.comments-empty{font-size:12px;color:#8f959e}.comment{padding:22px 0;border-bottom:1px solid #eff0f1}.comment-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px}.comment-avatar{width:28px;height:28px;border-radius:50%;object-fit:cover}.comment-handle,.comment-date{color:#8f959e;font-size:12px}.comment .body-text{min-height:0;font-size:14px;line-height:1.8;margin-top:12px}.comment .reader-media{margin:16px 0}.comment .reader-media img,.comment .reader-media video{max-height:45vh}.comment .post-actions{border:0;margin-top:14px;padding-top:0;gap:8px}.comment .post-actions button,.comment-thread,.comment-controls button{font-size:12px;padding:5px 9px;border:1px solid #dee0e3;border-radius:5px}.comment-thread{margin-left:auto;color:#646a73}.comment-controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.comments-footer{padding-top:20px;text-align:center}.comments-footer small{display:block;margin-top:8px;color:#8f959e;font-size:12px}
    .owner button{padding:0;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit}.owner button:hover,.author-link:hover{color:#3370ff}.author-link{padding:0;color:inherit}.profile-card{max-width:860px;border:1px solid #dee0e3;border-radius:8px;margin:6px 0 24px;padding:20px}.profile-top{display:flex;gap:12px;align-items:center}.profile-avatar{width:44px;height:44px;border-radius:50%;object-fit:cover}.profile-name{font-size:18px;font-weight:500}.profile-handle,.profile-stats{font-size:12px;color:#8f959e}.profile-follow{margin-left:auto;padding:7px 18px;border:1px solid #dee0e3;border-radius:6px}.profile-follow:not([aria-pressed="true"]){background:#3370ff;border-color:#3370ff;color:#fff}.profile-bio{margin:16px 0 12px;white-space:pre-wrap;line-height:1.7}.profile-bio a{color:#3370ff}.profile-stats{display:flex;gap:18px}
    .media-preview{position:fixed;inset:0;background:rgba(18,22,28,.88);z-index:30;padding:58px 30px 24px;display:flex;align-items:center;justify-content:center}.media-preview>img{max-width:100%;max-height:100%;object-fit:contain}.media-preview>button{position:absolute;top:14px;right:20px;color:#fff;border:1px solid #8f959e;border-radius:6px;padding:7px 14px;background:#20242c}
    .privacy-switch{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border-radius:5px;color:#646a73;font-size:12px;white-space:nowrap}.privacy-switch[aria-pressed="true"]{color:#245bdb;background:#edf2ff}.privacy-switch .icon{width:16px;height:16px}.privacy-media{position:relative;border-radius:6px}.privacy-media.is-private{overflow:hidden;background:#f2f3f5}.privacy-media.is-private:not(.privacy-avatar){min-height:180px}.privacy-media.is-private>.privacy-content{filter:blur(32px);opacity:0;pointer-events:none}.privacy-media>.privacy-reveal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px;background:linear-gradient(135deg,#e5e8ed,#f3f4f6 50%,#e4e7ec);color:#646a73;font-size:13px}.privacy-media>.privacy-hide{position:absolute;top:8px;right:8px;display:flex;align-items:center;gap:4px;width:auto;padding:5px 8px;border:1px solid #dee0e3;border-radius:5px;background:#fff;color:#646a73;font-size:12px}.privacy-avatar{display:inline-block;flex:none;border-radius:50%;overflow:hidden}.privacy-avatar>.privacy-content,.privacy-avatar>.privacy-content>img{width:100%;height:100%;display:block}.privacy-avatar .privacy-reveal{padding:0}.privacy-avatar .privacy-reveal span,.privacy-avatar .privacy-hide span{display:none}.privacy-avatar .privacy-reveal .icon,.privacy-avatar .privacy-hide .icon{width:12px;height:12px}.privacy-avatar>.privacy-hide{inset:0;width:100%;padding:0;justify-content:center;border:0;border-radius:50%;opacity:0}.privacy-avatar:hover>.privacy-hide,.privacy-avatar>.privacy-hide:focus-visible{opacity:1}.owner-dot>.privacy-avatar{width:100%;height:100%}.profile-top>.privacy-avatar{width:44px;height:44px}.comment-header>.privacy-avatar{width:28px;height:28px}
    @media(max-width:1100px){.app{grid-template-columns:240px minmax(0,1fr)}.table th:nth-child(4),.table td:nth-child(4){display:none}.table th:first-child{width:48%}.table th:nth-child(2){width:15%}.table th:nth-child(3){width:17%}.table th:nth-child(5){width:16%}.tabs{gap:18px}.view-tools{gap:6px}}
    @media(max-width:760px){.app{grid-template-columns:1fr}.sidebar{display:none}.topbar{height:58px;padding:0 16px}.scroll{padding:0 16px 20px}.actions{gap:8px;padding-bottom:14px}.action-card{height:58px;gap:8px;padding:0 10px}.card-text small,.action-card>.chevron{display:none}.action-card>.icon{width:21px;height:21px}.card-text strong{font-size:13px}.tabs{gap:16px}.tab{font-size:13px}.table th:nth-child(2),.table td:nth-child(2),.table th:nth-child(5),.table td:nth-child(5){display:none}.table th:first-child{width:72%}.table th:nth-child(3){width:22%}.table th:last-child{width:32px}.row-title{gap:8px;font-size:13px}.table td{padding:0 4px}.view-tools .filter-label,.view-switch{display:none}.paper{padding:35px 24px 70px}.paper h1,.note-title{font-size:24px}.reader-toolbar{padding:8px 12px}.top-tools{gap:5px}.popover{right:12px;width:min(286px,calc(100vw - 24px))}}
  `;

  function boot() {
    try {
      host = document.createElement('div');
      host.id = HOST_ID; host.dataset.version = '1.5.4';
      host.hidden = !activeMode();
      shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>${css}</style><div class="app">
        <aside class="sidebar"><div class="brand"><button class="brand-toggle" data-action="collapse" title="收起导航">${icon('collapse')}</button>${logo}<span>${BRAND}</span></div><form class="search-box" id="search-form">${icon('search')}<input id="search-input" type="search" placeholder="搜索" aria-label="筛选文档；按回车搜索 X" maxlength="200" autocomplete="off"></form>
          <nav class="nav"><button class="nav-item active" data-nav="home">${icon('home')}主页</button><button class="nav-item" data-nav="all">${icon('drive')}云盘</button><button class="nav-item" data-nav="saved">${icon('book')}知识库</button><button class="nav-item" data-nav="notes">${icon('lines')}智能纪要</button></nav>
          <div class="section-label">置顶知识库</div><button class="side-note" data-action="new-note">${icon('plus')}<span>新建或置顶知识库</span></button><div class="section-label">我的文档库<button class="icon-btn" data-action="new-note" title="新建">${icon('plus')}</button></div><div id="side-notes"></div><div class="side-bottom"><button class="icon-btn" data-nav="all" title="全部文档">${icon('disk')}</button><button class="icon-btn" data-action="settings" title="个人设置">${icon('lock')}</button><button class="icon-btn" data-filter="trash" title="回收站">${icon('trash')}</button></div>
        </aside>
        <main class="main"><header class="topbar"><div class="page-heading"><button class="icon-btn restore-sidebar" data-action="collapse" title="展开导航">${icon('collapse')}</button><h1 class="page-title" id="page-title">主页</h1></div><div class="top-tools"><button class="privacy-switch" data-action="privacy" aria-pressed="false">${icon('lock')}<span class="privacy-label">隐私模式：关</span></button><button class="icon-btn" data-action="search" title="搜索">${icon('search')}</button><button class="icon-btn" data-action="settings" title="个人设置">${icon('organization')}</button><button class="icon-btn" data-action="help" title="帮助">${icon('light')}</button><button class="icon-btn" data-action="help" title="帮助">${icon('grid')}</button><button class="avatar" data-action="settings" title="个人设置">文</button></div></header>
          <section class="scroll" id="list-view"><section id="profile-card" class="profile-card" hidden></section><div class="actions"><button class="action-card" data-action="new-note">${icon('new')}<span class="card-text"><strong>新建</strong><small>新建文档</small></span><span class="chevron">${icon('chevron')}</span></button><button class="action-card upload" data-action="upload">${icon('upload')}<span class="card-text"><strong>上传</strong><small>上传本地文件</small></span><span class="chevron">${icon('chevron')}</span></button><button class="action-card template" data-action="templates">${icon('template')}<span class="card-text"><strong>模板库</strong><small>选择模板快速新建</small></span></button></div>
            <div class="list-tools"><div class="tabs"><button class="tab active" data-filter="all">最近访问</button><button class="tab" data-filter="own">归我所有</button><button class="tab" data-filter="read">已阅读</button><button class="tab" data-filter="saved">收藏</button><button class="icon-btn" data-action="new-note" title="新建文档">${icon('plus')}</button></div><div class="view-tools"><button data-action="filters">${icon('filter')}<span class="filter-label">筛选</span></button><button data-action="settings">${icon('settings')}<span class="filter-label">显示设置</span></button><div class="view-switch"><button class="active" data-action="view-list" title="列表视图">${icon('list')}</button><button data-action="view-grid" title="网格视图">${icon('tiles')}</button></div></div></div>
            <table class="table"><thead><tr><th>标题</th><th>位置</th><th>所有者</th><th>创建时间</th><th>最近访问 ↓</th><th></th></tr></thead><tbody id="rows"></tbody></table><div class="empty" id="empty"><div>${icon('doc')}</div><p id="empty-message">正在整理文档…</p><button data-action="toggle">显示原界面</button></div><div class="footer"><button class="load-more" data-action="more">加载更多</button><small id="load-status"></small></div>
          </section><section class="reader-toolbar" id="reader-toolbar" hidden><button data-action="back">${icon('back')}返回列表</button><div><button data-action="reader-star">${icon('star')}本地收藏</button><button data-action="original">${icon('more')}原页面</button></div></section><section class="reader-scroll" id="reader-view" hidden><article class="paper" id="paper"></article></section>
        </main><section id="media-preview" class="media-preview" role="dialog" aria-label="媒体预览" hidden><button data-action="close-media">关闭媒体预览</button><img alt="原始图片" hidden></section><div class="popover" id="popover" hidden></div><div class="toast" id="toast" role="status" hidden></div><input id="file-input" type="file" accept=".txt,.md,text/plain,text/markdown" hidden>
      </div>`;
      document.body.append(host);
      shadow.addEventListener('click', onClick);
      $('#search-input').addEventListener('input', event => { state.query = event.target.value.trim(); renderList(); });
      $('#search-form').addEventListener('submit', event => {
        event.preventDefault();
        const query = $('#search-input').value.trim();
        if (query) location.assign('/search?q=' + encodeURIComponent(query) + '&src=typed_query&f=live');
      });
      $('#list-view').addEventListener('scroll', () => {
        const view = $('#list-view');
        if (!state.restoredList && view.scrollTop > 0 && view.scrollHeight - view.scrollTop - view.clientHeight < 180 && state.filter === 'all' && !state.query) loadMore();
      }, { passive: true });
      $('#file-input').addEventListener('change', importFile);
      document.addEventListener('click', event => { if (!event.composedPath().includes(host)) $('#popover').hidden = true; });
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      if (document.head) new MutationObserver(brandPage).observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'rel'] });
      restoreInitialView();
      applyMode();
      collect();
      // 不修改 history API；轮询只处理 X 自己的 SPA 路由切换。
      setInterval(() => {
        if (!state.enabled) return;
        updateRoute();
        collect();
      }, 1200);
    } catch (error) {
      state.enabled = false;
      document.documentElement.classList.remove(CLASS_NAME);
      document.documentElement.classList.remove('xdocs-privacy');
      if (host) host.hidden = true;
      for (const [node, previous] of inertRoots) node.inert = previous;
      inertRoots.clear();
      for (const [node, href] of originalIcons) href === null ? node.removeAttribute('href') : node.setAttribute('href', href);
      document.title = originalTitle;
      console.warn('[X 文档外观] 初始化失败，已恢复原界面。', error);
    }
  }

  function brandPage() {
    if (!activeMode() || !shadow) return;
    const desired = (state.reader ? titleOf(state.reader) : state.profile ? state.profile.name + '的主页' : '主页') + ' - ' + BRAND;
    if (document.title !== desired) {
      if (!document.title.endsWith(' - ' + BRAND)) originalTitle = document.title;
      document.title = desired;
    }
    const icons = document.querySelectorAll('link[rel~="icon"]');
    for (const node of icons) {
      if (node.getAttribute('href') !== favicon) {
        originalIcons.set(node, node.getAttribute('href'));
        node.setAttribute('href', favicon);
      }
    }
    if (!icons.length && document.head) {
      const node = document.createElement('link'); node.rel = 'icon'; node.href = favicon;
      node.dataset.xdocsOwned = 'true'; document.head.append(node);
    }
  }

  function applyMode() {
    if (!host) return;
    const active = activeMode();
    syncPrivacyControls();
    if (!active) { state.nativeUI = false; document.documentElement.classList.remove('xdocs-native-ui'); }
    host.hidden = !active;
    document.documentElement.classList.toggle(CLASS_NAME, active);
    if (active) {
      if (state.nativeUI) return;
      // inert 防止 Tab 键进入透明的原始界面；退出时恢复原属性。
      for (const node of document.body.children) {
        if (node === host || /^(SCRIPT|STYLE|LINK)$/.test(node.tagName)) continue;
        if (!inertRoots.has(node)) inertRoots.set(node, node.inert);
        node.inert = true;
      }
      pauseMedia(); brandPage(); scheduleScan();
    } else {
      shadow.querySelectorAll('video,audio').forEach(media => media.pause());
      for (const [node, previous] of inertRoots) node.inert = previous;
      inertRoots.clear();
      for (const [node, href] of originalIcons) {
        if (node.getAttribute('href') === favicon) href === null ? node.removeAttribute('href') : node.setAttribute('href', href);
      }
      originalIcons.clear();
      document.querySelectorAll('link[data-xdocs-owned]').forEach(node => node.remove());
      document.title = originalTitle;
      document.querySelector('main')?.focus?.();
    }
  }
  function toggle() { closeMediaPreview(); flushNote(); state.enabled = !state.enabled; save('enabled', state.enabled); applyMode(); }
  function pauseMedia() {
    if (state.nativeUI) return;
    document.querySelectorAll('video,audio').forEach(media => { if (!media.paused) media.pause(); });
  }
  document.addEventListener('play', event => {
    if (activeMode() && /^(VIDEO|AUDIO)$/.test(event.target.tagName)
      && (!state.nativeUI || (state.privacy && !event.target.closest('[data-xdocs-privacy-revealed]')))) event.target.pause();
  }, true);
  document.addEventListener('click', event => {
    if (!activeMode() || !state.privacy || event.composedPath().includes(host)) return;
    const media = event.target.closest?.('[data-testid="tweetPhoto"],[data-testid="videoPlayer"]') || event.target.closest?.('img,video');
    if (!media || media.closest('[data-xdocs-privacy-revealed]')) return;
    // 原生浮层第一次点击只揭示该媒体，不顺带打开链接、播放或触发其他 X 操作。
    event.preventDefault(); event.stopImmediatePropagation();
    media.setAttribute('data-xdocs-privacy-revealed', 'true');
  }, true);
  document.addEventListener('keydown', event => {
    if (event.altKey && event.shiftKey && event.code === 'KeyD') { event.preventDefault(); event.stopImmediatePropagation(); toggle(); }
    if (event.code === 'Escape' && shadow && !$('#media-preview').hidden) { event.preventDefault(); event.stopImmediatePropagation(); closeMediaPreview(); return; }
    if (state.nativeUI) return;
    if (activeMode() && event.code === 'Escape' && shadow) {
      event.preventDefault();
      if (!$('#popover').hidden) $('#popover').hidden = true;
      else if (state.reader) returnFromReader();
    }
    // 原页面可能注册全局快捷键；输入笔记时不能让按键透传给 X。
    if (activeMode() && shadow && event.composedPath().includes(host)) event.stopImmediatePropagation();
  }, true);
  GM_registerMenuCommand('切换：飞书云文档 / X（Alt+Shift+D）', toggle);
  GM_registerMenuCommand('开启 / 关闭隐私模式', togglePrivacy);

  function syncPrivacyControls() {
    document.documentElement.classList.toggle('xdocs-privacy', activeMode() && state.privacy);
    shadow?.querySelectorAll('[data-action="privacy"]').forEach(button => {
      button.setAttribute('aria-pressed', String(state.privacy));
      button.setAttribute('aria-label', '隐私模式：' + (state.privacy ? '开启' : '关闭'));
      button.title = state.privacy ? '点击关闭隐私模式' : '点击开启隐私模式';
      const label = button.querySelector('.privacy-label');
      if (label) label.textContent = '隐私模式：' + (state.privacy ? '开' : '关');
    });
  }
  function protectMedia(content, key, label, avatar = false) {
    const gate = make('div', 'privacy-media' + (avatar ? ' privacy-avatar' : ''));
    gate.dataset.privacyKey = key;
    const body = make('div', 'privacy-content'); body.append(content);
    const reveal = make('button', 'privacy-reveal'); reveal.dataset.action = 'reveal-media';
    reveal.setAttribute('aria-label', label + '已隐藏，点击显示');
    reveal.innerHTML = icon('lock'); reveal.append(make('span', '', label + '已隐藏，点击显示'));
    const hide = make('button', 'privacy-hide'); hide.dataset.action = 'hide-media';
    hide.setAttribute('aria-label', '重新隐藏' + label);
    hide.innerHTML = icon('lock'); hide.append(make('span', '', '重新隐藏'));
    gate.append(body, reveal, hide); updatePrivacyGate(gate); return gate;
  }
  function updatePrivacyGate(gate) {
    const hidden = state.privacy && !state.revealedMedia.has(gate.dataset.privacyKey);
    gate.classList.toggle('is-private', hidden);
    gate.querySelector('.privacy-content').inert = hidden;
    gate.querySelector('.privacy-reveal').hidden = !hidden;
    gate.querySelector('.privacy-hide').hidden = !state.privacy || hidden;
    // 模糊仍可能辨认颜色和轮廓；同时使用不透明遮罩，且不允许隐藏的视频继续出声。
    if (hidden) gate.querySelectorAll('video,audio').forEach(media => media.pause());
  }
  function resetMediaReveals() {
    // 单项揭示只留在当前阅读过程，刷新、换帖或再次开启隐私模式都不能自动放行。
    state.revealedMedia.clear();
    document.querySelectorAll('[data-xdocs-privacy-revealed]').forEach(node => node.removeAttribute('data-xdocs-privacy-revealed'));
    shadow?.querySelectorAll('.privacy-media').forEach(updatePrivacyGate);
  }
  function togglePrivacy() {
    closeMediaPreview(); state.privacy = !state.privacy; save('privacy', state.privacy);
    syncPrivacyControls(); resetMediaReveals();
    if (state.privacy) document.querySelectorAll('video,audio').forEach(media => media.pause());
    toast(state.privacy ? '隐私模式已开启，点击单个媒体后才显示。' : '隐私模式已关闭。');
  }

  function scheduleScan() {
    if (!activeMode() || scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; collect(); }, 240);
  }
  function postInfo(href) {
    try {
      const url = new URL(href, location.origin);
      if (!/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(url.hostname)) return null;
      const match = url.pathname.match(/^\/([\w]+)\/status\/(\d+)(?:\/|$)/) || url.pathname.match(/^\/i\/(?:web\/)?status\/(\d+)(?:\/|$)/);
      if (!match) return null;
      const handle = match.length === 3 ? match[1] : '';
      const id = match[match.length - 1];
      return { id, handle, url: location.origin + (handle ? '/' + handle : '/i/web') + '/status/' + id };
    } catch { return null; }
  }
  function plainText(node) {
    if (!node) return '';
    const copy = node.cloneNode(true);
    copy.querySelectorAll('img').forEach(image => image.replaceWith(image.alt || ''));
    copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    return copy.textContent.trim();
  }
  const X_CONTROLS = {
    reply: '[data-testid="reply"]', repost: '[data-testid="retweet"],[data-testid="unretweet"]',
    like: '[data-testid="like"],[data-testid="unlike"]',
    bookmark: '[data-testid="bookmark"],[data-testid="removeBookmark"]',
    share: '[data-testid="share"],[aria-label="Share post"],[aria-label="分享帖子"],[aria-label="分享貼文"]',
    views: 'a[href$="/analytics"]', expand: '[data-testid="tweet-text-show-more-link"]',
  };
  const actionNames = {reply:'回复', repost:'转帖', like:'点赞', bookmark:'X 书签', views:'浏览量', share:'分享'};
  function safeURL(value) {
    if (!value) return '';
    try { const url = new URL(value, location.origin); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; }
  }
  function richText(node) {
    if (!node) return '';
    const box = document.createElement('div');
    // 只重建文字、换行及安全链接；不执行 X 内容里的 HTML、样式或事件。
    const append = (source, target) => {
      if (source.nodeType === Node.TEXT_NODE) { target.append(document.createTextNode(source.textContent)); return; }
      if (source.nodeType !== Node.ELEMENT_NODE) return;
      if (source.tagName === 'BR') { target.append(document.createElement('br')); return; }
      if (source.tagName === 'IMG') { target.append(document.createTextNode(source.alt || '')); return; }
      if (source.tagName === 'A') {
        const href = safeURL(source.getAttribute('href'));
        if (href) {
          const link = document.createElement('a'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
          for (const child of source.childNodes) append(child, link); target.append(link); return;
        }
      }
      for (const child of source.childNodes) append(child, target);
    };
    for (const child of node.childNodes) append(child, box);
    return box.innerHTML;
  }
  function readMedia(article) {
    const media = [], seen = new Set();
    article.querySelectorAll('[data-testid="tweetPhoto"] img').forEach((image, index) => {
      const src = safeURL(image.currentSrc || image.getAttribute('src'));
      if (!src || seen.has(src) || image.closest('[data-testid="videoPlayer"]') || /(?:ext_tw|amplify|tweet)_video_thumb/.test(src)) return;
      seen.add(src); media.push({kind:'image', src, alt:image.alt || '', index:index + 1, viewer:safeURL(image.closest('a')?.getAttribute('href') || '')});
    });
    const video = article.querySelector('video');
    if (video || article.querySelector('[data-testid="videoPlayer"]')) {
      // MediaSource blob 不能复制为独立播放器，交给 X 原生媒体浮层播放。
      const src = video?.currentSrc || video?.getAttribute('src') || video?.querySelector('source')?.getAttribute('src');
      const poster = video?.getAttribute('poster') || article.querySelector('[data-testid="videoPlayer"] img')?.getAttribute('src');
      media.push({kind:'video', src:src && !src.startsWith('blob:') ? safeURL(src) : '', poster:poster ? safeURL(poster) : ''});
    }
    return media;
  }
  function readActions(article) {
    const result = {};
    for (const [action, selector] of Object.entries(X_CONTROLS)) {
      const control = article.querySelector(selector);
      const count = control?.textContent?.trim() || '';
      result[action] = { count:/^[\d.,\s]+(?:[KMkm万亿])?$/.test(count) ? count : '', available:!!control,
        active:!!control && /^(unlike|unretweet|removeBookmark)$/.test(control.dataset.testid || '') };
    }
    return result;
  }
  function nativeButton(record, action) {
    const status = record.actions?.[action] || {};
    const name = status.active ? {like:'取消点赞', repost:'转帖选项', bookmark:'移除 X 书签'}[action] || actionNames[action] : actionNames[action];
    const button = make('button', 'native-action', name + (status.count ? ' · ' + status.count : ''));
    button.dataset.xAction = action; button.dataset.recordId = record.id;
    if (['like','repost','bookmark'].includes(action)) button.setAttribute('aria-pressed', String(!!status.active));
    return button;
  }
  function articleIdentity(article) {
    // 时间线的主时间戳在作者栏；详情页的主时间戳在正文之后。引用帖的时间不能覆盖主帖 ID。
    const author = article.querySelector(SELECTORS.author);
    const times = Array.from(article.querySelectorAll('time'));
    const primary = times.find(time => author?.contains(time)) || times.at(-1);
    const info = postInfo(primary?.closest('a')?.getAttribute('href'));
    if (info) return {info, time:primary};
    for (const link of article.querySelectorAll('a[href*="/status/"]')) {
      const fallback = postInfo(link.getAttribute('href'));
      if (fallback) return {info:fallback, time:null};
    }
    return {info:null, time:null};
  }
  function liveArticle(id) {
    return Array.from(document.querySelectorAll(SELECTORS.posts)).find(article => articleIdentity(article).info?.id === id) || null;
  }
  function beginNativeUI() {
    state.nativeUI = true; state.nativeOpened = false; state.nativeUntil = Date.now() + 1400;
    document.documentElement.classList.add('xdocs-native-ui');
    for (const [node, previous] of inertRoots) node.inert = previous;
    inertRoots.clear();
    setTimeout(updateNativeUI, 80); setTimeout(updateNativeUI, 1500);
  }
  function updateNativeUI() {
    if (!state.nativeUI) return;
    const surfaces = Array.from(document.querySelectorAll('#layers [role="dialog"],#layers [role="menu"],#layers [data-testid="Dropdown"],.xdocs-native-media,body>[role="dialog"]'))
      .filter(node => node.getClientRects().length && getComputedStyle(node).display !== 'none');
    surfaces.forEach(node => node.classList.add('xdocs-native-surface'));
    if (surfaces.length) { state.nativeOpened = true; return; }
    if (!state.nativeOpened && Date.now() < state.nativeUntil) return;
    state.nativeUI = false; document.documentElement.classList.remove('xdocs-native-ui');
    document.querySelectorAll('.xdocs-native-surface').forEach(node => node.classList.remove('xdocs-native-surface'));
    applyMode();
  }
  function queueNativeAction(record, action, mediaIndex) {
    // 虚拟列表已回收帖子时，先让 X 加载该帖子，限定 ID 与有效期，避免误操作其他帖。
    save('pendingAction', {id:record.id, action, mediaIndex, expires:Date.now() + 20000});
    navigateToPost(record);
  }
  function resumePendingAction() {
    if (!activeMode() || state.nativeUI) return;
    const pending = load('pendingAction', null);
    if (!pending) return;
    if (pending.expires < Date.now()) { save('pendingAction', null); return; }
    const record = state.posts.get(pending.id);
    if (postInfo(location.href)?.id !== pending.id || !record || !liveArticle(pending.id)) return;
    save('pendingAction', null);
    if (pending.action === 'show-media') beginNativeUI();
    else setTimeout(() => xAction(record, pending.action, pending.mediaIndex), 0);
  }
  function xAction(record, action, mediaIndex = '1') {
    if (record.kind !== 'post') return;
    if (action === 'media') { openNativeVideo(record); return; }
    const article = liveArticle(record.id);
    if (!article) { toast('正在打开原帖…'); queueNativeAction(record, action, mediaIndex); return; }
    const control = article.querySelector(X_CONTROLS[action] || ':not(*)');
    if (!control) {
      if (action === 'expand') { queueNativeAction(record, 'read', mediaIndex); return; }
      if (action === 'read') { openReader(record); return; }
      toast('当前页面未提供此操作，正在打开原帖。'); queueNativeAction(record, 'read', mediaIndex); return;
    }
    beginNativeUI(); control.click(); scheduleScan();
  }

  function collect() {
    if (!activeMode() || !shadow) return;
    // DOM 更新可能早于路由轮询；先切换页面状态，避免把详情评论混进来源列表。
    updateRoute();
    updateNativeUI();
    // 原生视频预览临时解除虚拟单元格的 transform；播放期间不把临时位置当成讨论区排序。
    if (state.mediaNode) return;
    const profile = document.querySelector(SELECTORS.profile);
    try { state.ownHandle = new URL(profile.getAttribute('href'), location.origin).pathname.split('/')[1].toLowerCase(); }
    catch { state.ownHandle = ''; }
    const scope = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main') || document;
    const routeInfo = postInfo(state.overlayReturn || location.href) || (state.nativeUI && state.reader?.kind === 'post' ? postInfo(state.reader.url) : null);
    const articles = Array.from(scope.querySelectorAll(SELECTORS.posts));
    if (routeInfo) collectConversation(scope, articles, routeInfo);
    const replyIds = [];
    for (const article of articles) {
      const {info, time} = articleIdentity(article);
      if (!info) continue;
      // 返回时保留原列表及其顺序，新时间线条目只在用户继续加载时加入。
      if (!routeInfo && (state.restoredList || state.navigating) && !state.posts.has(info.id)) continue;
      const conversation = state.conversation;
      const y = article.getBoundingClientRect().top + window.scrollY;
      const replyTo = routeInfo && conversation?.startY !== null && info.id !== routeInfo.id
        && y > conversation.startY && y < conversation.endY ? routeInfo.id : '';
      // 详情页只缓存主帖和讨论区；不把上游对话或“发现更多”的推荐内容当成评论。
      if (routeInfo && info.id !== routeInfo.id && !replyTo) continue;
      const textNodes = Array.from(article.querySelectorAll(SELECTORS.text));
      const texts = textNodes.map(plainText);
      const previous = state.posts.get(info.id) || conversation?.replies.get(info.id);
      const name = plainText(article.querySelector(SELECTORS.author)?.querySelector('a')) || info.handle || '文档作者';
      const record = {
        ...info, kind: 'post', replyTo, text: texts[0] || '', author: name, quote: texts.slice(1).filter(Boolean).join('\n\n'),
        bodyHtml: richText(textNodes[0]), quoteHtml: textNodes.slice(1).map(richText).join('<br><br>'),
        media: readMedia(article), actions: readActions(article),
        avatar: safeURL(article.querySelector('img[src*="profile_images"]')?.getAttribute('src')),
        created: time?.getAttribute('datetime') || previous?.created || '',
        order: previous?.order || ++state.sequence, seen: previous?.seen || Date.now(), readAt: previous?.readAt || 0,
        nativeY: y,
        images: article.querySelectorAll('[data-testid="tweetPhoto"]').length,
        video: !!article.querySelector('video,[data-testid="videoPlayer"]'),
        truncated: !!article.querySelector('[data-testid="tweet-text-show-more-link"]'),
      };
      state.posts.set(info.id, record);
      if (replyTo) { conversation.replies.set(info.id, record); replyIds.push(info.id); }
    }
    if (routeInfo && state.conversation) mergeReplyOrder(replyIds);
    while (state.posts.size > MAX_POSTS) state.posts.delete(state.posts.keys().next().value);
    pauseMedia();
    // 新插入的原生浮层同样要从键盘焦点中排除。
    for (const node of document.body.children) {
      if (!state.nativeUI && node !== host && !/^(SCRIPT|STYLE|LINK)$/.test(node.tagName) && !inertRoots.has(node)) {
        inertRoots.set(node, node.inert); node.inert = true;
      }
    }
    renderProfile(); renderList(); renderSideNotes(); brandPage();
    // 原帖展开或翻译后，阅读页也跟随 DOM 内容更新，并保留阅读位置。
    if (state.reader?.kind === 'post' && $('#media-preview').hidden) {
      const latest = state.posts.get(state.reader.id);
      if (latest && (['text', 'bodyHtml', 'quoteHtml', 'images', 'video', 'truncated'].some(key => latest[key] !== state.reader[key]) || JSON.stringify(latest.media) !== JSON.stringify(state.reader.media) || JSON.stringify(latest.actions) !== JSON.stringify(state.reader.actions))) {
        const scrollTop = $('#reader-view').scrollTop;
        openReader(latest); $('#reader-view').scrollTop = scrollTop;
      }
    }
    renderComments();
    resumePendingAction();
    if (!state.autoOpened && routeInfo && state.posts.has(routeInfo.id)) {
      state.autoOpened = true; openReader(state.posts.get(routeInfo.id));
      if (!state.conversation?.replies.size && !state.conversation?.complete) loadComments();
    }
  }

  function profileHandle() {
    const match = location.pathname.match(/^\/([a-zA-Z0-9_]{1,15})(?:\/(?:with_replies|media|highlights|articles))?\/?$/);
    return match && !/^(home|explore|notifications|messages|search|settings|compose|login|logout|i)$/i.test(match[1]) ? match[1] : '';
  }
  function profileFollowControl() {
    const scope = document.querySelector('[data-testid="primaryColumn"]');
    const header = scope?.querySelector('[data-testid="UserName"]')?.parentElement;
    if (!header) return null;
    return Array.from(scope?.querySelectorAll('[data-testid$="-follow"],[data-testid$="-unfollow"]') || [])
      .find(node => !node.closest('article') && node.getClientRects().length);
  }
  function renderProfile() {
    const handle = profileHandle(), scope = document.querySelector('[data-testid="primaryColumn"]');
    const nameNode = handle && scope?.querySelector('[data-testid="UserName"]');
    const box = $('#profile-card');
    if (!nameNode && (!handle || state.profile?.handle !== handle)) { state.profile = null; state.profileKey = ''; box.hidden = true; return; }
    const control = profileFollowControl();
    const avatar = scope?.querySelector(`[data-testid="UserAvatar-Container-${handle}"] img`);
    const profile = !nameNode ? state.profile : {handle, name:plainText(nameNode).split('@')[0].trim() || handle,
      bio:richText(scope.querySelector('[data-testid="UserDescription"]')),
      avatar:safeURL(avatar?.currentSrc || avatar?.getAttribute('src')),
      following:!!control?.dataset.testid.endsWith('-unfollow'), available:!!control,
      own:state.ownHandle === handle.toLowerCase(),
      stats:Array.from(scope.querySelectorAll(`a[href="/${handle}/following"],a[href="/${handle}/verified_followers"],a[href="/${handle}/followers"]`), plainText)};
    state.profile = profile; box.hidden = false;
    if (!state.reader && state.filter === 'all') $('#page-title').textContent = profile.name + '的文档';
    const key = JSON.stringify(profile);
    if (state.profileKey === key) return;
    state.profileKey = key; box.replaceChildren();
    const top = make('div', 'profile-top');
    if (profile.avatar) { const image = make('img', 'profile-avatar'); image.src = profile.avatar; image.alt = profile.name; top.append(protectMedia(image, 'profile-avatar:' + handle + ':' + profile.avatar, '头像', true)); }
    const info = make('div'); info.append(make('div', 'profile-name', profile.name), make('div', 'profile-handle', '@' + handle)); top.append(info);
    if (!profile.own) {
      const follow = make('button', 'profile-follow', profile.following ? '取消关注' : '关注');
      follow.dataset.action = 'profile-follow'; follow.dataset.handle = handle; follow.disabled = !profile.available;
      follow.setAttribute('aria-pressed', String(profile.following)); top.append(follow);
    }
    box.append(top);
    if (profile.bio) { const bio = make('div', 'profile-bio'); bio.innerHTML = profile.bio; box.append(bio); }
    const stats = make('div', 'profile-stats'); profile.stats.forEach(text => stats.append(make('span', '', text))); box.append(stats);
  }

  function allRecords() { return [...state.notes, ...state.posts.values()].filter(record => !record.replyTo); }
  function visibleRecords() {
    const query = state.query.toLocaleLowerCase();
    return allRecords().filter(record => {
      if (state.filter === 'saved' && !state.favorites.has(record.id)) return false;
      if (state.filter === 'own' && record.kind !== 'note' && (!state.ownHandle || record.handle.toLowerCase() !== state.ownHandle)) return false;
      if (state.filter === 'notes' && record.kind !== 'note') return false;
      if (state.filter === 'trash') return false;
      if (state.filter === 'read' && !record.readAt) return false;
      return !query || [titleOf(record), record.text, record.author].join(' ').toLocaleLowerCase().includes(query);
    });
  }
  function renderList() {
    if (!shadow || state.reader) return;
    const records = visibleRecords();
    const body = $('#rows');
    // 重用行节点，避免每次 X 更新时丢失焦点和列表滚动位置。
    const existing = new Map(Array.from(body.children, row => [row.dataset.id, row]));
    const wanted = new Set(records.map(record => record.id));
    for (const [id, row] of existing) if (!wanted.has(id)) row.remove();
    records.forEach((record, index) => {
      let row = existing.get(record.id);
      if (!row) {
        row = make('tr'); row.dataset.id = record.id;
        row.innerHTML = `<td><button class="row-title" data-action="read">${icon('doc')}<span></span></button></td><td><div class="location">${icon('folder')}<span></span></div></td><td><div class="owner"><span class="owner-dot"></span><button data-action="profile"></button></div></td><td></td><td></td><td><button class="icon-btn row-menu" data-action="row-menu" aria-label="文档操作">${icon('more')}</button></td>`;
      }
      row.querySelector('.row-title span').textContent = titleOf(record);
      row.querySelector('.row-title').title = headlineOf(record);
      row.querySelector('.location span').textContent = record.kind === 'note' ? '个人' : state.favorites.has(record.id) ? '知识库' : '云盘';
      const avatar = row.querySelector('.owner-dot');
      if (/^https:\/\/pbs\.twimg\.com\//.test(record.avatar || '')) {
        let image = avatar.querySelector('img');
        const key = 'list-avatar:' + record.id + ':' + record.avatar;
        if (!image) { avatar.textContent = ''; image = make('img'); image.alt = ''; avatar.append(protectMedia(image, key, '头像', true)); }
        if (image.getAttribute('src') !== record.avatar) image.src = record.avatar;
        const gate = avatar.querySelector('.privacy-media'); gate.dataset.privacyKey = key; updatePrivacyGate(gate);
      } else avatar.textContent = Array.from(record.author || '我')[0];
      const authorButton = row.querySelector('.owner button');
      authorButton.textContent = record.author || '我'; authorButton.dataset.handle = record.handle || '';
      authorButton.disabled = record.kind !== 'post'; authorButton.title = record.kind === 'post' ? '查看作者主页' : '本地文档';
      row.children[3].textContent = formatDate(record.created);
      row.children[4].textContent = formatDate(record.readAt || record.seen || record.created);
      row.querySelector('.row-menu').setAttribute('aria-label', titleOf(record) + '的操作');
      if (body.children[index] !== row) body.insertBefore(row, body.children[index] || null);
    });
    $('#empty').hidden = records.length > 0;
    $('#empty-message').textContent = state.query ? '没有匹配的文档。按回车可搜索更多内容。' : state.filter === 'all'
      ? '暂未读取到内容。正在等待页面加载；需要登录时请切回原界面。'
      : state.filter === 'saved' ? '暂无本地收藏，可在文档操作菜单中添加。'
      : state.filter === 'own' ? '暂无自己的帖子或本地文档。' : state.filter === 'trash' ? '回收站为空。' : '暂无文档。';
    $('.load-more').hidden = state.filter !== 'all' || !!state.query;
    $('.load-more').textContent = state.loading ? `正在加载…（新增 ${Math.max(0, state.sequence - state.loadStart)} 条）` : '加载更多';
    $('.load-more').disabled = state.loading;
    $('#load-status').textContent = records.length ? `${records.length} 份文档` : '';
    shadow.querySelectorAll('[data-filter]').forEach(node => {
      node.classList.toggle('active', node.dataset.filter === state.filter);
      node.setAttribute('aria-pressed', String(node.dataset.filter === state.filter));
    });
  }
  function renderSideNotes() {
    const target = $('#side-notes');
    const records = allRecords().slice(0, 9);
    const fingerprint = records.map(record => record.id + titleOf(record)).join('|');
    if (target.dataset.fingerprint === fingerprint) return;
    target.dataset.fingerprint = fingerprint; target.replaceChildren();
    if (!records.length) target.append(make('div', 'side-quiet', '暂无文档'));
    for (const record of records) {
      const button = make('button', 'side-note'); button.dataset.action = 'note'; button.dataset.id = record.id;
      button.title = headlineOf(record);
      button.innerHTML = icon('note-doc'); button.append(make('span', '', titleOf(record))); target.append(button);
    }
  }
  function filter(value, nav) {
    closeReader(); state.filter = value; $('#list-view').scrollTop = 0;
    shadow.querySelectorAll('[data-nav]').forEach(node => node.classList.toggle('active', node.dataset.nav === (nav || value)));
    $('#page-title').textContent = ({ saved: '知识库', notes: '智能纪要', all: '主页', own: '归我所有', read: '最近阅读', trash: '回收站' })[value] || '主页';
    renderList();
  }

  function appendPostContent(target, record) {
    const body = make('div', 'body-text');
    body.innerHTML = record.bodyHtml || '';
    if (!record.bodyHtml) body.textContent = record.text;
    target.append(body);
    if (record.quote) {
      target.append(make('h2', '', '引用内容'));
      const quote = make('div', 'body-text'); quote.innerHTML = record.quoteHtml || '';
      if (!record.quoteHtml) quote.textContent = record.quote;
      target.append(quote);
    }
    for (const media of record.media || []) {
      const figure = make('figure', 'reader-media');
      const content = make('div');
      if (media.kind === 'image') {
        const button = make('button'); button.dataset.action = 'preview-image'; button.dataset.imageSrc = media.src; button.dataset.imageAlt = media.alt || '原始图片';
        button.setAttribute('aria-label', '查看原始图片');
        const image = make('img'); image.src = media.src; image.alt = media.alt || '帖文图片'; image.loading = 'lazy';
        button.append(image); content.append(button);
      } else if (media.src) {
        const video = make('video'); video.src = media.src; video.controls = true; video.preload = 'metadata';
        if (media.poster) video.poster = media.poster; content.append(video);
      } else {
        const button = make('button'); button.dataset.xAction = 'media'; button.dataset.recordId = record.id; button.dataset.video = 'true';
        if (media.poster) { const image = make('img'); image.src = media.poster; image.alt = '视频封面'; button.append(image); }
        button.append(make('span', 'attachments', '打开原生视频播放器')); content.append(button);
      }
      if (media.alt && media.alt !== 'Image' && media.alt !== '图像') content.append(make('figcaption', '', media.alt));
      const key = record.id + ':media:' + media.kind + ':' + (media.src || media.poster || media.index || 'video');
      figure.append(protectMedia(content, key, media.kind === 'image' ? '图片' : '视频'));
      target.append(figure);
    }
    // 时间线摘要需要 X 自己加载完整原文；保留原帖链接，不伪造缺失正文。
    if (record.truncated) {
      const more = make('button', 'attachments', '展开完整正文'); more.dataset.xAction = 'expand'; more.dataset.recordId = record.id; target.append(more);
    }
    const actions = make('div', 'post-actions');
    for (const action of ['reply', 'repost', 'like', 'bookmark', 'views', 'share']) actions.append(nativeButton(record, action));
    target.append(actions);
  }
  function readRecord(record) {
    // 时间线没有完整讨论区；打开真实详情路由让 X 加载评论，继续使用页面已有 DOM。
    if (record.kind === 'post' && postInfo(location.href)?.id !== record.id) { navigateToPost(record); return; }
    openReader(record);
  }
  function postReturnRoutes() {
    // sessionStorage 随当前标签页保存来源；不能用油猴共享存储，否则其他标签页会覆盖返回目标。
    try {
      const routes = JSON.parse(sessionStorage.getItem(STORE + 'returnRoutes') || '[]');
      if (!Array.isArray(routes)) return [];
      return routes.filter(route => route && validReturnPath(route.from) && validReturnPath(route.to)).slice(-16);
    } catch { return []; }
  }
  function validReturnPath(path) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return false;
    try {
      const url = new URL(path, location.origin);
      return url.origin === location.origin && !/^\/(?:compose|login|i\/flow|i\/jf)(?:\/|$)/.test(url.pathname);
    } catch { return false; }
  }
  function savePostReturnRoutes(routes) {
    try { sessionStorage.setItem(STORE + 'returnRoutes', JSON.stringify(routes)); }
    catch { /* 标签页存储不可用时，返回真实 X 首页，不能在详情路由上伪造首页。 */ }
  }
  function rememberRouteView() {
    const route = state.overlayReturn || state.route;
    if (!validReturnPath(route)) return;
    const conversation = state.conversation;
    const view = {
      route, savedAt: Date.now(), posts: [...state.posts.entries()], sequence: state.sequence,
      filter: state.filter, query: state.query, profile: state.profile,
      listTitle: state.reader ? state.listTitle : $('#page-title').textContent,
      nav: shadow.querySelector('[data-nav].active')?.dataset.nav || 'home',
      listScroll: state.reader ? state.listScroll || 0 : $('#list-view').scrollTop,
      readerId: state.reader?.kind === 'post' ? state.reader.id : '', readerScroll: $('#reader-view').scrollTop,
      nativeScroll: window.scrollY,
      conversation: conversation ? {...conversation, replies: [...conversation.replies.entries()], order: [...conversation.order], loading: false} : null,
    };
    state.routeViews.delete(route); state.routeViews.set(route, view);
    while (state.routeViews.size > 8) state.routeViews.delete(state.routeViews.keys().next().value);
  }
  function persistRouteViews() {
    // 原生虚拟列表找不到旧帖链接时才需要跨整页导航兜底；快照只存当前标签页，不存媒体揭示状态。
    try {
      const views = [...state.routeViews.values()];
      let text = JSON.stringify(views);
      while (text.length > 1500000 && views.length) { views.shift(); text = JSON.stringify(views); }
      sessionStorage.setItem(STORE + 'routeViews', text);
    } catch { /* 超出浏览器配额时仍保留内存快照，正常 SPA 返回不受影响。 */ }
  }
  function restoreRouteView(view) {
    state.posts = new Map(view?.posts || []); state.sequence = view?.sequence || 0;
    state.filter = view?.filter || 'all'; state.query = view?.query || '';
    state.profile = view?.profile || null; state.profileKey = '';
    // JSON 将 Infinity 序列化为 null；未遇到推荐区边界的讨论仍要允许继续收集评论。
    state.conversation = view?.conversation ? {...view.conversation, endY: view.conversation.endY ?? Infinity, replies: new Map(view.conversation.replies), order: [...view.conversation.order], loading: false} : null;
    state.loading = false; state.lastLoad = 0; state.autoOpened = false; state.navigating = false;
    state.restoredList = !!view && !postInfo(location.href); state.listScroll = view?.listScroll || 0;
    $('#search-input').value = state.query;
    shadow.querySelectorAll('[data-nav]').forEach(node => node.classList.toggle('active', node.dataset.nav === (view?.nav || 'home')));
    closeReader(); renderProfile(); renderSideNotes();
    if (view?.listTitle) $('#page-title').textContent = view.listTitle;
    const reader = view?.readerId && state.posts.get(view.readerId);
    if (reader && postInfo(location.href)?.id === reader.id) { state.autoOpened = true; openReader(reader); }
    const restoreScroll = () => {
      if (view && view.route !== state.route) return;
      $('#list-view').scrollTop = state.listScroll;
      if (reader) $('#reader-view').scrollTop = view.readerScroll || 0;
      if (view && !postInfo(location.href)) window.scrollTo({top: view.nativeScroll || 0, behavior: 'instant'});
    };
    restoreScroll(); requestAnimationFrame(restoreScroll);
  }
  function restoreInitialView() {
    try {
      const returning = sessionStorage.getItem(STORE + 'restoreRoute') === state.route
        || performance.getEntriesByType('navigation')[0]?.type === 'back_forward';
      sessionStorage.removeItem(STORE + 'restoreRoute');
      const views = JSON.parse(sessionStorage.getItem(STORE + 'routeViews') || '[]');
      if (!Array.isArray(views)) return;
      for (const view of views) if (view && validReturnPath(view.route) && Array.isArray(view.posts) && Date.now() - view.savedAt < 1800000) state.routeViews.set(view.route, view);
      const view = state.routeViews.get(state.route);
      if (returning && view) restoreRouteView(view);
    } catch { /* 过期、损坏或不可用的快照不阻止 X 正常加载。 */ }
  }
  function updateRoute() {
    const route = location.pathname + location.search;
    if (route === state.route) return;
    const overlay = /^\/compose\//.test(location.pathname) || /\/status\/\d+\/(photo|video)\/\d+\/?$/.test(location.pathname);
    // X 的原生弹窗会改变地址；打开和关闭浮层不应清空文档及阅读位置。
    if (state.nativeUI && overlay) { state.overlayReturn ||= state.route; state.route = route; return; }
    if (state.overlayReturn === route) { state.overlayReturn = null; state.route = route; applyMode(); return; }
    rememberRouteView(); state.overlayReturn = null; state.route = route;
    // 浏览器自己的后退也会结束当前层来源，避免子讨论的旧记录干扰父帖再次返回。
    const routes = postReturnRoutes();
    while (routes.length && routes[routes.length - 1].from === route) routes.pop();
    savePostReturnRoutes(routes);
    try { if (sessionStorage.getItem(STORE + 'restoreRoute') === route) sessionStorage.removeItem(STORE + 'restoreRoute'); } catch { /* 仅清理兜底导航标记。 */ }
    restoreRouteView(state.routeViews.get(route)); applyMode();
  }
  function nativePostLink(record) {
    const article = liveArticle(record.id);
    if (!article) return null;
    const {time} = articleIdentity(article);
    const link = time?.closest('a');
    if (link && postInfo(link.href)?.id === record.id) return link;
    return Array.from(article.querySelectorAll('a[href*="/status/"]')).find(node => {
      const url = new URL(node.href, location.origin);
      return postInfo(url.href)?.id === record.id && /^\/[\w]+\/status\/\d+\/?$/.test(url.pathname);
    }) || null;
  }
  async function navigateToPost(record) {
    if (state.navigating) return;
    const from = state.overlayReturn || location.pathname + location.search;
    const destination = new URL(record.url, location.origin);
    const to = destination.pathname + destination.search;
    const samePost = postInfo(new URL(from, location.origin).href)?.id === record.id;
    rememberRouteView();
    if (!samePost && destination.origin === location.origin && from !== to && validReturnPath(from) && validReturnPath(to)) {
      let routes = postReturnRoutes();
      // 新的列表入口重新开始；从评论进入子讨论时保留返回原帖的路径。
      if (routes[routes.length - 1]?.to !== from) routes = [];
      routes.push({from, to, historyLength: history.length}); savePostReturnRoutes(routes.slice(-16));
    }
    state.navigating = true;
    let link = nativePostLink(record);
    // X 会回收屏外单元格；先回到该帖原位置，等真实链接重新挂载，仍交由 X 自己导航。
    if (!link && Number.isFinite(record.nativeY)) {
      window.scrollTo({top: Math.max(0, record.nativeY - 120), behavior: 'instant'});
      for (let attempt = 0; attempt < 8 && !link; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 150));
        if (from !== location.pathname + location.search) { state.navigating = false; return; }
        link = nativePostLink(record);
      }
    }
    if (link) {
      link.click();
      await new Promise(resolve => setTimeout(resolve, 200));
      if (from !== location.pathname + location.search) { updateRoute(); collect(); return; }
    }
    // X 没提供可点击链接时保留来源快照，避免兜底跳转后返回丢失列表。
    persistRouteViews();
    location.assign(record.url);
  }
  function returnFromReader() {
    if (state.reader?.kind !== 'post' || !postInfo(location.href)) { closeReader(); return; }
    if (state.navigating) return;
    const current = location.pathname + location.search;
    const routes = postReturnRoutes();
    const source = routes[routes.length - 1];
    // 只使用当前帖子对应的来源；直接进入帖子或失效的来源回到 /home。
    const destination = source?.to === current ? routes.pop().from : '/home';
    savePostReturnRoutes(routes);
    rememberRouteView(); state.navigating = true;
    // 仅在已知来源紧邻当前历史项时后退，不能把用户带到其他网站或失效的旧页面。
    if (source?.to === current && Number.isInteger(source.historyLength) && history.length === source.historyLength + 1) {
      history.back(); return;
    }
    persistRouteViews();
    try { sessionStorage.setItem(STORE + 'restoreRoute', destination); } catch { /* 正常导航不依赖存储。 */ }
    const link = Array.from(document.querySelectorAll('a[href]')).find(node => {
      try { const url = new URL(node.href, location.origin); return url.origin === location.origin && url.pathname + url.search === destination; }
      catch { return false; }
    });
    if (link) { link.click(); setTimeout(() => { if (location.pathname + location.search === current) location.assign(destination); }, 250); return; }
    location.assign(destination);
  }
  function collectConversation(scope, articles, info) {
    if (state.conversation?.id !== info.id) state.conversation = {
      id:info.id, replies:new Map(), order:[], startY:null, endY:Infinity, complete:false,
      loading:false, loadStart:0, lastLoad:0, message:'',
    };
    const conversation = state.conversation;
    const main = articles.find(article => articleIdentity(article).info?.id === info.id);
    if (main) conversation.startY = main.getBoundingClientRect().top + window.scrollY;
    if (conversation.startY === null) return;
    const boundary = Array.from(scope.querySelectorAll('h2,[role="heading"]')).find(node =>
      /^(发现更多|探索更多|Discover more|Découvrir plus|Descubre más|Mehr entdecken|顯示更多|發現更多)$/i.test(plainText(node))
      && node.getBoundingClientRect().top + window.scrollY > conversation.startY);
    if (boundary) {
      conversation.endY = (boundary.closest('[data-testid="cellInnerDiv"]') || boundary).getBoundingClientRect().top + window.scrollY;
      conversation.complete = true;
      // 边界的位置可能因图片加载或正文展开而变化，已缓存记录也需要重新排除推荐帖。
      for (const [id, record] of conversation.replies) {
        const node = articles.find(article => articleIdentity(article).info?.id === id);
        if (node && node.getBoundingClientRect().top + window.scrollY >= conversation.endY) {
          conversation.replies.delete(id); if (state.posts.get(id)?.replyTo) state.posts.delete(id);
        }
      }
    }
    while (conversation.replies.size > MAX_POSTS) conversation.replies.delete(conversation.replies.keys().next().value);
  }
  function mergeReplyOrder(ids) {
    if (!ids.length) return;
    const conversation = state.conversation;
    const visible = new Set(ids), previous = conversation.order;
    const anchor = ids.find(id => previous.includes(id));
    const before = anchor ? previous.slice(0, previous.indexOf(anchor)) : previous;
    const index = before.filter(id => !visible.has(id)).length;
    // 虚拟列表回收屏外节点；使用当前 DOM 的顺序合并已读段落。图片和翻译改变高度时仍保持回复位置。
    const merged = previous.filter(id => !visible.has(id)); merged.splice(index, 0, ...ids);
    conversation.order = merged.filter(id => conversation.replies.has(id));
  }
  function commentControls() {
    const conversation = state.conversation;
    if (!conversation || conversation.startY === null) return [];
    const scope = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main');
    return Array.from(scope?.querySelectorAll('button,[role="button"],a[role="link"]') || []).filter(node => {
      const y = node.getBoundingClientRect().top + window.scrollY;
      return !node.closest(SELECTORS.posts) && y > conversation.startY && y < conversation.endY
        && /^(?:显示.*回复|查看.*回复|显示可能的垃圾.*|顯示.*回覆|查看.*回覆|Show (?:more |additional |probable spam|.*replies)|View .*replies)/i.test(plainText(node));
    });
  }
  function commentKey(record) {
    return JSON.stringify([record.author,record.avatar,record.created,record.text,record.bodyHtml,record.quoteHtml,record.media,record.actions,record.truncated]);
  }
  function renderComments() {
    const section = $('#post-comments');
    if (!section || state.reader?.kind !== 'post') return;
    const conversation = state.conversation?.id === state.reader.id ? state.conversation : null;
    const records = (conversation?.order || []).map(id => conversation.replies.get(id)).filter(Boolean);
    section.querySelector('.comments-status').textContent = records.length ? `已显示 ${records.length} 条` : '';
    const list = section.querySelector('.comments-list');
    const present = new Map(Array.from(list.children, node => [node.dataset.id,node]));
    for (const record of records) {
      let item = present.get(record.id); present.delete(record.id);
      if (item?.dataset.fingerprint === commentKey(record)) continue;
      const updated = make('article', 'comment'); updated.dataset.id = record.id; updated.dataset.fingerprint = commentKey(record);
      const header = make('header', 'comment-header');
      if (record.avatar) { const image = make('img', 'comment-avatar'); image.src = record.avatar; image.alt = ''; image.loading = 'lazy'; header.append(protectMedia(image, 'comment-avatar:' + record.id + ':' + record.avatar, '头像', true)); }
      const author = make('button', 'author-link', record.author); author.dataset.action = 'profile'; author.dataset.handle = record.handle;
      const thread = make('button', 'comment-thread', '查看回复'); thread.dataset.action = 'read-comment'; thread.dataset.id = record.id;
      header.append(author, make('span', 'comment-handle', record.handle ? '@' + record.handle : ''), make('time', 'comment-date', formatDate(record.created)), thread);
      updated.append(header); appendPostContent(updated, record);
      if (item) item.replaceWith(updated); else list.append(updated);
    }
    present.forEach(node => node.remove());
    // 展开中间的子回复时插回 X 的原始位置，而不是永远追加到评论末尾。
    records.forEach((record, index) => {
      const item = Array.from(list.children).find(node => node.dataset.id === record.id);
      if (item && list.children[index] !== item) list.insertBefore(item, list.children[index] || null);
    });
    const empty = section.querySelector('.comments-empty'); empty.hidden = !!records.length;
    empty.textContent = conversation?.complete ? '当前讨论区没有可展示的评论。' : conversation?.message && !conversation.loading ? '暂未读取到评论，可以重试加载。' : '评论正在加载…';
    const controls = section.querySelector('.comment-controls');
    const labels = Array.from(new Set(commentControls().map(plainText)));
    if (controls.dataset.fingerprint !== labels.join('|')) {
      controls.dataset.fingerprint = labels.join('|'); controls.replaceChildren();
      for (const label of labels) { const button = make('button', '', label); button.dataset.action = 'expand-comments'; button.dataset.label = label; controls.append(button); }
    }
    const more = section.querySelector('[data-action="more-comments"]');
    more.hidden = !!conversation?.complete; more.disabled = !!conversation?.loading;
    more.textContent = conversation?.loading ? `正在加载评论…（新增 ${records.length - conversation.loadStart} 条）` : '加载更多评论';
    section.querySelector('.comments-footer small').textContent = conversation?.loading ? '正在读取后续评论' : conversation?.message || (conversation?.complete ? '已展示当前讨论区的已加载评论' : '继续查看后续评论');
  }
  async function loadComments() {
    const conversation = state.conversation;
    if (!conversation || conversation.complete || conversation.loading || state.reader?.id !== conversation.id) return;
    await loadNativeBatch(conversation);
  }

  function openReader(record) {
    if (!state.reader) { state.listScroll = $('#list-view').scrollTop; state.listTitle = $('#page-title').textContent; }
    closeMediaPreview();
    if (state.reader?.id !== record.id) resetMediaReveals();
    shadow.querySelectorAll('video,audio').forEach(media => media.pause());
    flushNote(); state.reader = record; record.readAt = Date.now();
    for (const view of state.routeViews.values()) {
      const cached = view.posts.find(([id]) => id === record.id)?.[1];
      if (cached) cached.readAt = record.readAt;
    }
    if (record.kind === 'note') save('notes', state.notes);
    $('#list-view').hidden = true; $('#reader-view').hidden = false; $('#reader-toolbar').hidden = false;
    $('#page-title').textContent = '文档'; $('#popover').hidden = true;
    const paper = $('#paper'); paper.replaceChildren();
    if (record.kind === 'note') {
      const title = make('input', 'note-title'); title.value = record.title; title.placeholder = '无标题文档'; title.maxLength = 120; title.setAttribute('aria-label', '文档标题');
      const metadata = make('div', 'metadata', '本地文档 · 仅保存在当前浏览器');
      const text = make('textarea', 'note-body'); text.value = record.text; text.maxLength = 512000; text.placeholder = '开始记录…'; text.setAttribute('aria-label', '文档正文');
      const update = () => {
        record.title = title.value.trim() || '无标题文档'; record.text = text.value;
        clearTimeout(noteTimer); noteTimer = setTimeout(() => { save('notes', state.notes); renderSideNotes(); brandPage(); }, 400);
      };
      title.addEventListener('input', update); text.addEventListener('input', update);
      paper.append(title, metadata, text);
    } else {
      paper.append(make('h1', '', titleOf(record)));
      const metadata = make('div', 'metadata');
      const author = make('button', 'author-link', record.author); author.dataset.action = 'profile'; author.dataset.handle = record.handle;
      metadata.append(author, make('span', '', formatDate(record.created)), make('span', '', '原始帖文'));
      paper.append(metadata);
      appendPostContent(paper, record);
      const comments = make('section', 'comments'); comments.id = 'post-comments';
      comments.setAttribute('aria-label', '评论区');
      comments.innerHTML = '<div class="comments-heading"><h2>评论</h2><span class="comments-status"></span></div><div class="comments-list"></div><p class="comments-empty"></p><div class="comment-controls"></div><div class="comments-footer"><button class="load-more" data-action="more-comments">加载更多评论</button><small></small></div>';
      paper.append(comments); renderComments();
    }
    $('#reader-view').scrollTop = 0; brandPage();
  }
  function flushNote() {
    if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; save('notes', state.notes); }
  }
  function closeReader() {
    if (!shadow) return;
    closeMediaPreview();
    resetMediaReveals();
    shadow.querySelectorAll('video,audio').forEach(media => media.pause());
    flushNote(); state.reader = null;
    $('#reader-view').hidden = true; $('#reader-toolbar').hidden = true; $('#list-view').hidden = false;
    $('#page-title').textContent = state.profile ? state.profile.name + '的文档' : '主页'; renderList(); brandPage();
  }
  function newNote(title = '无标题文档', text = '') {
    if (state.notes.length >= 50) { toast('已达到 50 份本地文档上限。'); return; }
    const record = { id: 'note-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), kind: 'note', title, text, author: '我', created: Date.now(), seen: Date.now() };
    state.notes.unshift(record); save('notes', state.notes); renderSideNotes(); openReader(record);
    $('#paper input')?.focus();
  }
  async function importFile(event) {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 512000) { toast('请选择小于 500 KB 的文本文件。'); return; }
    try { newNote(file.name.replace(/\.(txt|md)$/i, ''), await file.text()); }
    catch { toast('未能读取该文本文件。'); }
  }
  function star(record) {
    if (!record) return;
    if (state.favorites.has(record.id)) state.favorites.delete(record.id); else state.favorites.add(record.id);
    save('favorites', Array.from(state.favorites).slice(-1000)); renderList();
    toast(state.favorites.has(record.id) ? '已加入本地收藏' : '已取消本地收藏');
  }
  async function loadMore() {
    if (!activeMode() || state.loading || state.reader || state.navigating || Date.now() - state.lastLoad < 900) return;
    if (!state.posts.size) { collect(); toast('页面尚无可读取内容；需要登录时请切回原界面。'); return; }
    state.restoredList = false;
    await loadNativeBatch();
  }
  async function loadNativeBatch(conversation = null) {
    const route = location.pathname + location.search;
    const progress = conversation || state;
    const count = () => conversation ? conversation.replies.size : state.sequence;
    progress.lastLoad = Date.now(); progress.loadStart = count(); progress.loading = true;
    conversation ? renderComments() : renderList();
    let idle = 0, previous = count();
    try {
      if (!conversation) {
        // 文档列表保留了屏外帖文，但 X 返回后可能停在较靠前的位置。
        // 从最后已读帖的原生位置接续，不能把重走缓存区的几屏当作没有新内容。
        const tail = [...state.posts.values()].filter(record => record.kind === 'post' && Number.isFinite(record.nativeY))
          .reduce((last, record) => !last || record.order > last.order ? record : last, null);
        if (tail && tail.nativeY - 120 > window.scrollY + innerHeight) {
          window.scrollTo({top: Math.max(0, tail.nativeY - 120), behavior: 'instant'});
          await new Promise(resolve => setTimeout(resolve, 650));
          if (route !== location.pathname + location.search || state.reader || state.navigating) return;
          collect(); previous = count();
        }
      }
      // X 按原帖高度虚拟化页面；连续逐屏收集同一讨论/时间线的一批，避免跳过屏外节点。
      for (let step = 0; step < 32 && Date.now() - progress.lastLoad < 22000; step++) {
        if (!activeMode() || state.nativeUI || state.navigating || route !== location.pathname + location.search) break;
        if (conversation ? state.reader?.id !== conversation.id || state.conversation !== conversation || conversation.complete
          : state.reader || state.filter !== 'all' || state.query) break;
        if (count() - progress.loadStart >= LOAD_BATCH_SIZE) break;
        const beforeY = window.scrollY;
        window.scrollBy({ top:Math.max(600, innerHeight * 0.85), behavior:'instant' });
        await new Promise(resolve => setTimeout(resolve, 650)); collect();
        // 时间线仍在推进时，遇到缓存帖不代表已经到末尾；评论区保留原有停止条件。
        idle = count() === previous && (conversation || window.scrollY <= beforeY + 1) ? idle + 1 : 0; previous = count();
        if (idle >= 7) break;
      }
    } finally {
      const added = Math.max(0, count() - progress.loadStart); progress.loading = false;
      if (conversation) conversation.message = added ? `已新增 ${added} 条评论` : conversation.complete ? '已展示当前讨论区的已加载评论' : '暂未读取到更多评论，可以稍后重试';
      collect();
      if (!conversation && activeMode() && route === location.pathname + location.search) toast(added ? `已新增 ${added} 条` : '暂未加载到新内容，请稍后再试。');
    }
  }
  function toast(message) {
    if (!shadow) return;
    $('#toast').textContent = message; $('#toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3300);
  }
  function popover(kind, record) {
    const box = $('#popover');
    if (!box.hidden && box.dataset.kind === kind) { box.hidden = true; return; }
    box.dataset.kind = kind; box.hidden = false;
    if (kind === 'settings') {
      box.innerHTML = `<strong>显示设置</strong><button data-action="privacy">${icon('lock')}<span class="privacy-label">隐私模式</span></button><p>开启后图片、视频和头像完全遮蔽，点击单个媒体才显示；刷新或换帖后重新隐藏。</p><hr><p>标题取自正文首行，长标题会截短；悬停可查看完整首行。</p><hr><button data-action="toggle">显示 X 原界面</button><p>快捷键：Alt + Shift + D<br>地址栏仍然显示原网站地址。</p>`;
      syncPrivacyControls();
    } else if (kind === 'filters') {
      box.innerHTML = '<strong>筛选文档</strong><button data-filter="all">全部文档</button><button data-filter="own">归我所有</button><button data-filter="read">已阅读</button><button data-filter="saved">收藏</button><button data-filter="notes">本地笔记</button>';
    } else if (kind === 'row-menu' && record) {
      box.dataset.recordId = record.id;
      box.replaceChildren(make('strong', '', '文档操作'));
      const read = make('button', '', '打开文档'); read.dataset.action = 'menu-read'; box.append(read);
      if (record.kind === 'post') {
        const profile = make('button', '', '作者主页'); profile.dataset.action = 'profile'; profile.dataset.handle = record.handle; box.append(profile);
        box.append(make('hr'));
        for (const action of ['reply', 'repost', 'like', 'bookmark', 'views', 'share']) box.append(nativeButton(record, action));
        box.append(make('hr'));
      }
      const star = make('button', '', state.favorites.has(record.id) ? '取消本地收藏' : '加入本地收藏'); star.dataset.action = 'menu-star';
      const original = make('button', '', '查看原页面'); original.dataset.action = 'menu-original'; box.append(star, original);
    } else if (kind === 'templates') {
      box.innerHTML = '<strong>模板库</strong><button data-template="meeting">会议纪要</button><button data-template="project">项目备忘</button><button data-template="reading">阅读笔记</button><p>模板创建为本地文档，不会发布到 X。</p>';
    } else {
      box.innerHTML = '<strong>使用帮助</strong><p>点击文档标题阅读原帖正文、引用和图片。视频使用可用的原始媒体或 X 播放器。</p><p>搜索框筛选已加载内容；回车搜索 X。加载更多连续读取一批后续时间线。</p><p>本地收藏和笔记属于当前浏览器。X 书签、点赞、回复、转帖和分享使用 X 原有控件。</p><p>Alt + Shift + D 切换外观。Esc 关闭菜单或返回列表。</p><button data-action="toggle">显示原界面</button>';
    }
  }
  function closeMediaPreview() {
    if (!shadow) return;
    $('#media-preview').hidden = true; $('#media-preview img').hidden = true;
    if (state.mediaNode) {
      state.mediaNode.querySelectorAll('video,audio').forEach(media => media.pause());
      state.mediaNode.removeAttribute('data-xdocs-privacy-revealed');
      state.mediaNode.classList.remove('xdocs-native-media', 'xdocs-native-surface'); state.mediaNode = null;
      for (const node of state.mediaAncestors || []) node.classList.remove('xdocs-media-ancestor');
      state.mediaAncestors = []; updateNativeUI();
    }
  }
  function openNativeVideo(record) {
    const article = liveArticle(record.id);
    if (!article) { queueNativeAction(record, 'media', 'video'); return; }
    const player = article.querySelector('[data-testid="videoPlayer"]') || article.querySelector('video')?.parentElement;
    if (!player) { toast('当前原帖尚未加载播放器，可打开原页面查看。'); return; }
    // 只改变现有播放器的展示位置；不搬动 React 节点，不复制 MediaSource blob 或猜测媒体路由。
    closeMediaPreview();
    // 此入口来自用户已点击的视频；先放行该播放器，再展示原生浮层，避免误放行其他媒体。
    if (state.privacy) player.setAttribute('data-xdocs-privacy-revealed', 'true');
    beginNativeUI(); state.mediaNode = player;
    // 虚拟列表的 transform 会让 fixed 播放器跟随旧单元格偏移；预览期间仅解除这些祖先，关闭后还原。
    state.mediaAncestors = [];
    for (let node = player.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none' || style.contain !== 'none') {
        node.classList.add('xdocs-media-ancestor'); state.mediaAncestors.push(node);
      }
    }
    player.classList.add('xdocs-native-media', 'xdocs-native-surface'); $('#media-preview').hidden = false;
    requestAnimationFrame(() => {
      if (state.mediaNode !== player) return;
      const play = player.querySelector('button[aria-label="播放"],button[aria-label="Play"]');
      if (play) play.click(); else player.querySelector('video')?.play()?.catch(() => {});
    }); updateNativeUI();
  }
  function onClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.action === 'reveal-media' || button.dataset.action === 'hide-media') {
      const gate = button.closest('.privacy-media');
      if (!gate || !state.privacy) return;
      const reveal = button.dataset.action === 'reveal-media';
      if (reveal) state.revealedMedia.add(gate.dataset.privacyKey);
      else { closeMediaPreview(); state.revealedMedia.delete(gate.dataset.privacyKey); }
      shadow.querySelectorAll('.privacy-media').forEach(updatePrivacyGate);
      (reveal ? gate.querySelector('.privacy-hide') : gate.querySelector('.privacy-reveal')).focus();
      return;
    }
    if (button.dataset.action === 'preview-image') {
      closeMediaPreview(); const image = $('#media-preview img');
      image.src = button.dataset.imageSrc; image.alt = button.dataset.imageAlt; image.hidden = false; $('#media-preview').hidden = false; return;
    }
    if (button.dataset.action === 'close-media') { closeMediaPreview(); return; }
    if (button.dataset.action === 'profile') {
      const handle = button.dataset.handle;
      if (/^[a-zA-Z0-9_]{1,15}$/.test(handle || '')) location.assign('/' + handle);
      return;
    }
    if (button.dataset.action === 'profile-follow') {
      // 每次点击重新取当前主页控件，避免关注状态变化后引用旧节点或误操作推荐用户。
      const handle = profileHandle();
      if (!handle || handle.toLowerCase() !== (button.dataset.handle || '').toLowerCase()) return;
      const control = profileFollowControl();
      if (!control) { toast('当前用户主页尚未提供关注操作。'); return; }
      beginNativeUI(); control.click(); scheduleScan(); return;
    }
    if (button.dataset.xAction) {
      const record = state.posts.get(button.dataset.recordId) || state.conversation?.replies.get(button.dataset.recordId);
      $('#popover').hidden = true;
      if (record) xAction(record, button.dataset.xAction, button.dataset.mediaURL || (button.dataset.video === 'true' ? 'video' : button.dataset.mediaIndex || '1'));
      return;
    }
    if (button.dataset.nav) {
      const nav = button.dataset.nav;
      if (nav === 'home' && location.pathname !== '/home') location.assign('/home'); else filter(nav === 'home' ? 'all' : nav, nav);
      return;
    }
    if (button.dataset.filter) { $('#popover').hidden = true; filter(button.dataset.filter); return; }
    if (button.dataset.template) {
      const templates = { meeting: ['会议纪要', '会议主题：\n会议时间：\n参会人员：\n\n讨论要点\n\n待办事项\n'], project: ['项目备忘', '项目目标\n\n当前进展\n\n问题与风险\n\n下一步\n'], reading: ['阅读笔记', '资料来源：\n\n要点摘录\n\n思考与结论\n'] };
      newNote(...templates[button.dataset.template]); return;
    }
    const recordId = button.closest('[data-id]')?.dataset.id;
    const record = state.posts.get(recordId) || state.conversation?.replies.get(recordId) || state.notes.find(note => note.id === recordId);
    switch (button.dataset.action) {
      case 'read': case 'note': case 'read-comment': if (record) readRecord(record); break;
      case 'star': star(record); break;
      case 'reader-star': star(state.reader); break;
      case 'back': returnFromReader(); break;
      case 'toggle': toggle(); break;
      case 'privacy': togglePrivacy(); break;
      case 'more': loadMore(); break;
      case 'more-comments': loadComments(); break;
      case 'expand-comments': {
        const control = commentControls().find(node => plainText(node) === button.dataset.label);
        if (control && state.conversation) {
          state.conversation.complete = false; state.conversation.endY = Infinity; state.conversation.message = '';
          control.click(); scheduleScan();
        }
        break;
      }
      case 'settings': case 'templates': case 'help': case 'filters': popover(button.dataset.action); break;
      case 'collapse': $('.app').classList.toggle('collapsed'); break;
      case 'view-list': case 'view-grid': {
        const grid = button.dataset.action === 'view-grid';
        $('.table').classList.toggle('grid', grid);
        $('[data-action="view-list"]').classList.toggle('active', !grid);
        $('[data-action="view-grid"]').classList.toggle('active', grid);
        break;
      }
      case 'row-menu': if (record) popover('row-menu', record); break;
      case 'menu-read': case 'menu-star': case 'menu-original': {
        const selected = allRecords().find(item => item.id === $('#popover').dataset.recordId);
        $('#popover').hidden = true;
        if (!selected) break;
        if (button.dataset.action === 'menu-read') readRecord(selected);
        else if (button.dataset.action === 'menu-star') star(selected);
        else if (selected.kind === 'post') { toggle(); location.assign(selected.url); }
        else toast('这是本地文档，没有 X 原页面。');
        break;
      }
      case 'search': {
        if (innerWidth > 760) $('#search-input').focus();
        else { const query = prompt('搜索 X'); if (query?.trim()) location.assign('/search?q=' + encodeURIComponent(query.trim()) + '&src=typed_query&f=live'); }
        break;
      }
      case 'new-note': newNote(); break;
      case 'upload': $('#file-input').click(); break;
      case 'original': {
        const current = state.reader;
        if (current?.kind === 'post') {
          toggle();
          if (postInfo(location.href)?.id !== current.id) location.assign(current.url);
        } else toast('这是本地文档，没有 X 原页面。');
        break;
      }
    }
  }
  window.addEventListener('pagehide', flushNote);
  if (document.body) boot();
  else {
    const ready = new MutationObserver(() => { if (document.body) { ready.disconnect(); boot(); } });
    ready.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
