const MAX_BUFFERED_MESSAGES = 500;
const MAX_BUFFERED_TABS = 25;

const connections = new Map();
const pendingByTab = new Map();

const bufferMessage = (tabId, msg, createBuffer) => {
  let buffer = pendingByTab.get(tabId);

  if (!buffer) {
    if (!createBuffer) {
      return;
    }
    if (pendingByTab.size >= MAX_BUFFERED_TABS) {
      pendingByTab.delete(pendingByTab.keys().next().value);
    }
    buffer = [];
    pendingByTab.set(tabId, buffer);
  }

  if (buffer.length >= MAX_BUFFERED_MESSAGES) {
    buffer.shift();
  }
  buffer.push(msg);
};

const dispatch = (tabId, msg, createBuffer) => {
  const port = connections.get(tabId);
  if (port) {
    port.postMessage(msg);
    return;
  }
  bufferMessage(tabId, msg, createBuffer);
};

const decodeRequestBody = (requestBody) => {
  if (!requestBody) {
    return null;
  }

  if (requestBody.raw?.length) {
    try {
      const decoder = new TextDecoder();
      const chunks = requestBody.raw.map((chunk) =>
        chunk.bytes ? decoder.decode(chunk.bytes, { stream: true }) : ''
      );
      return chunks.join('') + decoder.decode();
    } catch (e) {
      return null;
    }
  }

  if (requestBody.formData) {
    return JSON.stringify(requestBody.formData);
  }

  return null;
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'networkwizard') {
    return;
  }

  let connectedTabId = null;

  port.onMessage.addListener((msg) => {
    if (msg.type !== 'init' || !msg.tabId) {
      return;
    }

    connectedTabId = msg.tabId;
    connections.set(connectedTabId, port);

    const buffered = pendingByTab.get(connectedTabId);
    if (buffered) {
      buffered.forEach((req) => port.postMessage(req));
      pendingByTab.delete(connectedTabId);
    }
  });

  port.onDisconnect.addListener(() => {
    if (connectedTabId === null) {
      return;
    }
    if (connections.get(connectedTabId) === port) {
      connections.delete(connectedTabId);
    }
    pendingByTab.delete(connectedTabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  connections.delete(tabId);
  pendingByTab.delete(tabId);
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) {
      return;
    }

    const url = details.url;
    if (url.startsWith('chrome') || url.startsWith('devtools') || url.startsWith('data:')) {
      return;
    }

    dispatch(
      details.tabId,
      {
        type: 'requestStart',
        requestId: details.requestId,
        url: details.url,
        method: details.method,
        bodyText: decodeRequestBody(details.requestBody),
        timestamp: details.timeStamp
      },
      true
    );
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) {
      return;
    }

    dispatch(
      details.tabId,
      {
        type: 'requestEnd',
        requestId: details.requestId,
        statusCode: details.statusCode
      },
      false
    );
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId < 0) {
      return;
    }

    dispatch(
      details.tabId,
      {
        type: 'requestError',
        requestId: details.requestId,
        error: details.error
      },
      false
    );
  },
  { urls: ['<all_urls>'] }
);
