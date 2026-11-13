import { fetchWithTimeout } from './network';
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetchWithTimeout('/api' + path, { ...options, credentials:'same-origin', cache:'no-store', headers:{ 'Content-Type':'application/json', ...options.headers } });
  let result:T & {error?:string};
  try {result=await response.json();} catch {throw new Error('Сервер временно недоступен. Повторите запрос.');}
  if (!response.ok) throw Object.assign(new Error(result.error || 'Не удалось выполнить запрос'), {status:response.status});
  return result;
}
