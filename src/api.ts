export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, { ...options, credentials:'same-origin', headers:{ 'Content-Type':'application/json', ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Не удалось выполнить запрос'), {status:response.status});
  return result;
}
