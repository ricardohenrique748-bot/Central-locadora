/**
 * Cliente HTTP da API do módulo de orçamentos.
 * Sessão via cookie httpOnly; mutações enviam o cabeçalho X-CL-Request (proteção CSRF).
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json', 'X-CL-Request': '1' } : { 'X-CL-Request': '1' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Falha de comunicação com o servidor. Verifique sua conexão.');
  }
  if (res.status === 401 && !url.startsWith('/auth/')) {
    window.dispatchEvent(new Event('cl:unauthorized'));
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || `Erro ${res.status}`, data?.fields);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Baixa um arquivo autenticado (PDF/CSV) e devolve o Blob. */
export async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(`/api${url}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error || `Erro ${res.status}`);
  }
  return res.blob();
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
