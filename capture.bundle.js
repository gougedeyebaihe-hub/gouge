const TOKEN_STATE_KEY = "lynkco.share.tokenState";

function serializeTokenState(tokenState) {
  return JSON.stringify({
    token: tokenState.token || "",
    refreshToken: tokenState.refreshToken || "",
  });
}

function parseTokenState(raw) {
  if (!raw) return { token: "", refreshToken: "" };
  try {
    const parsed = JSON.parse(raw);
    return {
      token: parsed.token || "",
      refreshToken: parsed.refreshToken || "",
    };
  } catch (error) {
    return { token: "", refreshToken: "" };
  }
}

function extractTokenState(request) {
  const headers = request.headers || {};
  const token = headers.token || headers.Token || "";
  const url = new URL(request.url);
  const refreshToken = url.searchParams.get("refreshToken") || "";

  return { token, refreshToken };
}

function hasTokenState(tokenState) {
  return Boolean(tokenState.token || tokenState.refreshToken);
}

function mergeTokenState(previousState, nextState) {
  return {
    token: nextState.token || previousState.token || "",
    refreshToken: nextState.refreshToken || previousState.refreshToken || "",
  };
}

function writeTokenState(store, tokenState) {
  return store.write(serializeTokenState(tokenState), TOKEN_STATE_KEY);
}

function runCapture(options = {}) {
  const request = options.request || $request;
  const store = options.store || $persistentStore;
  const done = options.done || $done;
  const tokenState = extractTokenState(request);

  if (hasTokenState(tokenState)) {
    const previousTokenState = parseTokenState(store.read(TOKEN_STATE_KEY));
    writeTokenState(store, mergeTokenState(previousTokenState, tokenState));
  }

  done({});
}

runCapture();
