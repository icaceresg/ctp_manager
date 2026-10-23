// Pequeño envoltorio de fetch para hablar con el servidor local.

export const UNAUTHORIZED_EVENT = 'mrm:unauthorized';

async function request(method, url, body, requestOptions = {}) {
  const options = { method, headers: {}, credentials: 'same-origin', signal: requestOptions.signal };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`/api${url}`, options);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('No se puede contactar con el servidor de CTP Manager.');
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/auth/')) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url, options) => request('GET', url, undefined, options),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};
