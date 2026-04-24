const TOKEN_STATE_KEY = "lynkco.share.tokenState";

function serializeTokenState(tokenState) {
  return JSON.stringify({
    token: tokenState.token || "",
    refreshToken: tokenState.refreshToken || "",
  });
}

function extractTokenState(request) {
  const headers = request.headers || {};
  const token = headers.token || headers.Token || "";
  const url = new URL(request.url);
  const refreshToken = url.searchParams.get("refreshToken") || "";

  return { token, refreshToken };
}

function writeTokenState(store, tokenState) {
  return store.write(serializeTokenState(tokenState), TOKEN_STATE_KEY);
}

function runCapture(options = {}) {
  const request = options.request || $request;
  const store = options.store || $persistentStore;
  const done = options.done || $done;
  const tokenState = extractTokenState(request);

  if (tokenState.token || tokenState.refreshToken) {
    writeTokenState(store, tokenState);
  }

  done({});
}

runCapture();
