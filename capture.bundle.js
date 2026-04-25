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

function parseJson(data) {
  if (!data || typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

function findTokenState(value) {
  if (!value || typeof value !== "object") {
    return { token: "", refreshToken: "" };
  }

  const directToken = value.token || value.accessToken || "";
  const directRefreshToken = value.refreshToken || value.refresh_token || "";
  if (directToken || directRefreshToken) {
    return {
      token: directToken,
      refreshToken: directRefreshToken,
    };
  }

  const keys = Object.keys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const nestedState = findTokenState(value[keys[index]]);
    if (nestedState.token || nestedState.refreshToken) {
      return nestedState;
    }
  }

  return { token: "", refreshToken: "" };
}

function mergeExtractedTokenState(firstState, secondState) {
  return {
    token: secondState.token || firstState.token || "",
    refreshToken: secondState.refreshToken || firstState.refreshToken || "",
  };
}

function extractBodyTokenState(body) {
  return findTokenState(parseJson(body));
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
  const response = options.response || (typeof $response === "undefined" ? null : $response);
  const store = options.store || $persistentStore;
  const done = options.done || $done;
  const tokenState = mergeExtractedTokenState(
    mergeExtractedTokenState(extractTokenState(request), extractBodyTokenState(request.body)),
    extractBodyTokenState(response && response.body),
  );

  if (hasTokenState(tokenState)) {
    const previousTokenState = parseTokenState(store.read(TOKEN_STATE_KEY));
    writeTokenState(store, mergeTokenState(previousTokenState, tokenState));
  }

  done({});
}

runCapture();
