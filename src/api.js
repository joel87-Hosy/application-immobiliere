export async function api(path,options={},retry=true) {
 const response=await fetch('/api'+path,{credentials:'same-origin',...options,headers:options.body instanceof FormData?options.headers:{'Content-Type':'application/json',...options.headers}});
 if(response.status===401&&retry&&!path.startsWith('/auth/')) {const refresh=await fetch('/api/auth/refresh',{method:'POST'});if(refresh.ok) return api(path,options,false);}
 if(!response.ok) {const body=await response.json().catch(()=>({error:'Le serveur est indisponible.'}));throw new Error(body.error||'Une erreur est survenue.');}
 return response.status===204?null:response.json();
}
export function exportCsv(rows,name) {
 if(!rows.length) return;
 const escape=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
 const csv='\ufeff'+[Object.keys(rows[0]),...rows.map(Object.values)].map(row=>row.map(escape).join(';')).join('\r\n');
 download(new Blob([csv],{type:'text/csv;charset=utf-8'}),name+'.csv');
}
export function download(blob,name) {const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
