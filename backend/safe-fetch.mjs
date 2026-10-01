// Workers supports only "manual" and "follow" redirect modes. Never follow
// a redirect when sending credentials or fetching identity signing keys.
export async function fetchWithoutRedirect(url,options={},fetcher=(...args)=>fetch(...args)){
 const response=await fetcher(url,{...options,redirect:'manual'});
 if(response.redirected||(response.status>=300&&response.status<400)){
  try{await response.body?.cancel();}catch{}
  // Do not expose Location, request URLs, credentials, or upstream bodies.
  throw new Error('UPSTREAM_REDIRECT_BLOCKED');
 }
 return response;
}
