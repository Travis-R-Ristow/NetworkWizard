const connections = new Map();
const pendingByTab = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'networkwizard') {
    return;
  }

  let connectedTabId = null;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'init' && msg.tabId) {
      connectedTabId = msg.tabId;
      connections.set(connectedTabId, port);

      const buffered = pendingByTab.get(connectedTabId);
      if (buffered) {
        buffered.forEach((req) => port.postMessage(req));
        pendingByTab.delete(connectedTabId);
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (connectedTabId) {
      connections.delete(connectedTabId);
      pendingByTab.delete(connectedTabId);
    }
  });
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

    let bodyText = null;
    if (details.requestBody?.raw?.[0]?.bytes) {
      try {
        bodyText = new TextDecoder().decode(details.requestBody.raw[0].bytes);
      } catch (e) {}
    } else if (details.requestBody?.formData) {
      bodyText = JSON.stringify(details.requestBody.formData);
    }

    const msg = {
      type: 'requestStart',
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      bodyText,
      timestamp: details.timeStamp
    };

    const port = connections.get(details.tabId);
    if (port) {
      port.postMessage(msg);
    } else {
      if (!pendingByTab.has(details.tabId)) {
        pendingByTab.set(details.tabId, []);
      }
      const buffer = pendingByTab.get(details.tabId);
      if (buffer.length < 500) {
        buffer.push(msg);
      }
    }
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) {
      return;
    }

    const msg = {
      type: 'requestEnd',
      requestId: details.requestId,
      statusCode: details.statusCode
    };

    const port = connections.get(details.tabId);
    if (port) {
      port.postMessage(msg);
    } else if (pendingByTab.has(details.tabId)) {
      pendingByTab.get(details.tabId).push(msg);
    }
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId < 0) {
      return;
    }

    const msg = {
      type: 'requestError',
      requestId: details.requestId,
      error: details.error
    };

    const port = connections.get(details.tabId);
    if (port) {
      port.postMessage(msg);
    } else if (pendingByTab.has(details.tabId)) {
      pendingByTab.get(details.tabId).push(msg);
    }
  },
  { urls: ['<all_urls>'] }
);
