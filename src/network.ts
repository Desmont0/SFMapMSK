// AbortSignal.timeout is unavailable in older Safari and Telegram WebViews.
export async function fetchWithTimeout(url:string,options:RequestInit={},timeout=12000) {
  const controller=new AbortController();
  const abort=()=>controller.abort();
  if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,timeout);
  try {
    const response=await fetch(url,{...options,signal:controller.signal});
    // Read the body under the same deadline; a stalled body must also time out.
    const body=await response.arrayBuffer();
    return new Response([204,205,304].includes(response.status)?null:body,{status:response.status,statusText:response.statusText,headers:response.headers});
  } finally {clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
