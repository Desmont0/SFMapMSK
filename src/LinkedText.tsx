import { Fragment } from 'react';
export function LinkedText({text}:{text:string}) {
  return text.split(/(https?:\/\/[^\s<>"']+)/gi).map((part,index)=>{
    if(!/^https?:\/\//i.test(part))return <Fragment key={index}>{part}</Fragment>;
    const url=part.replace(/[.,!?;:)\]»]+$/,'');
    return <Fragment key={index}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a>{part.slice(url.length)}</Fragment>;
  });
}
