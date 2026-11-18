var http=require('http'),tls=require('tls'),net=require('net'),url=require('url');
var port=8119;
var logs=[],tickets={};function log(x){logs.push(new Date().toISOString().slice(11,19)+' '+x);if(logs.length>18)logs.shift();}
function handler(req,res){
 var origin=req.headers.origin,q=url.parse(req.url,true);
 var ticket=tickets[String(q.query.ticket||'')], permitted=['/stream','/view','/resource','/api'].indexOf(q.pathname)>=0&&ticket&&ticket.until>Date.now();
 if(['127.0.0.1:'+port,'localhost:'+port].indexOf(req.headers.host)<0 || (['http://127.0.0.1:8081','http://localhost:8081'].indexOf(origin)<0 && !permitted)){log('Rejected '+req.method+' '+q.pathname+' origin='+(origin||'none'));res.writeHead(403);return res.end();}
 if(origin)res.setHeader('Access-Control-Allow-Origin',origin);if(permitted&&q.pathname==='/api')res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/json');
 if(req.method==='OPTIONS'&&origin){res.setHeader('Access-Control-Allow-Methods','GET, HEAD, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Range, Content-Type');res.statusCode=204;return res.end();}
 if(req.method!=='GET'&&!(permitted&&(req.method==='HEAD'||(q.pathname==='/api'&&req.method==='POST')))){res.statusCode=405;return res.end();}
 if(q.pathname==='/health')return res.end(JSON.stringify({ok:true,version:'0.9.0'}));
 if(q.pathname==='/logs')return res.end(JSON.stringify({logs:logs}));
 if(permitted){q.query.host=ticket.host;q.query.port=ticket.port;q.query.proto=ticket.proto;}
 var host=String(q.query.host||''),p=Number(q.query.port),mode=q.pathname,socks=q.query.proto==='socks';
 if(['/test','/youtube','/media','/play','/stream','/ytbody','/ticket','/ytasset','/ytthumb','/ytpage','/view','/resource','/api'].indexOf(mode)<0||net.isIP(host)!==4||! /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host)||!isFinite(p)||p<1||p>65535||p%1){res.statusCode=400;return res.end(JSON.stringify({error:'Invalid private IPv4 or port'}));}
 if(mode==='/ticket'){var keys=Object.keys(tickets);for(var i=0;i<keys.length;i++)if(tickets[keys[i]].until<Date.now())delete tickets[keys[i]];if(Object.keys(tickets).length>=32){res.statusCode=429;return res.end(JSON.stringify({error:'Too many sessions'}));}var token=require('crypto').randomBytes(18).toString('hex');tickets[token]={host:host,port:p,proto:q.query.proto,ua:String(q.query.ua||''),until:Date.now()+600000};return res.end(JSON.stringify({ticket:token}));}
 if(mode==='/stream'){if(!permitted){res.statusCode=403;return res.end();}log(req.method+' stream Range: '+(req.headers.range||'none'));}
 var media=mode==='/media'||mode==='/play'||mode==='/stream',target=(mode==='/youtube'||mode==='/ytbody')?'www.youtube.com':media?'interactive-examples.mdn.mozilla.net':'api.ipify.org';
 var path=(mode==='/youtube'||mode==='/ytbody')?'/tv':media?'/media/cc0-videos/flower.mp4':'/';
 if(mode==='/view'||mode==='/resource'){if(!permitted){res.statusCode=403;return res.end();}q.query.ua=ticket.ua;if(mode==='/view'){target='www.youtube.com';path='/tv';}else{var a=url.parse(String(q.query.asset||''));if(a.protocol!=='https:'||['www.youtube.com','www.gstatic.com','s.ytimg.com','i.ytimg.com','youtube.com','fonts.googleapis.com','fonts.gstatic.com'].indexOf(a.hostname)<0||a.auth||a.port||!a.pathname||! /\.(js|css|png|jpg|jpeg|webp|woff2?|svg)$/i.test(a.pathname)||/[\r\n]/.test(a.path)){res.statusCode=400;return res.end();}target=a.hostname;path=a.path;}}
 if(mode==='/api'){if(!permitted||req.method!=='POST'){res.statusCode=403;return res.end();}var ap=url.parse(String(q.query.asset||''));if(ap.protocol!=='https:'||ap.hostname!=='www.youtube.com'||ap.auth||ap.port||!/^\/youtubei\/v1\/(browse|next|search|guide|player)$/.test(ap.pathname||'')||/[\r\n]/.test(ap.path)){res.statusCode=403;return res.end(JSON.stringify({error:'API not allowed'}));}target=ap.hostname;path=ap.path;q.query.ua=ticket.ua;}
 if(mode==='/ytpage'){target='www.youtube.com';path='/tv';}
 if(mode==='/ytasset'){var a=url.parse(String(q.query.asset||''));if(a.protocol!=='https:'||['www.youtube.com','www.gstatic.com','s.ytimg.com','i.ytimg.com','youtube.com','fonts.googleapis.com','fonts.gstatic.com'].indexOf(a.hostname)<0||a.auth||a.port||!a.pathname||! /\.(js|css)$/.test(a.pathname)||/[\r\n]/.test(a.path)){res.statusCode=400;return res.end(JSON.stringify({error:'Unsupported asset URL'}));}target=a.hostname;path=a.path;}
 if(mode==='/ytthumb'){target='i.ytimg.com';path='/vi/jNQXAC9IVRw/hqdefault.jpg';}
 var ua=String(q.query.ua||'Mozilla/5.0').replace(/[^\x20-\x7e]/g,'').slice(0,512);
 var rangeRequest=String(req.headers.range||'');if(rangeRequest&&!/^bytes=\d*-\d*$/.test(rangeRequest)){res.statusCode=416;return res.end();}
 var done=false,sock,secure,request,timer,started=Date.now(),stage='TCP to proxy',trace=[],stream=false;
 function mark(x){stage=x;trace.push(x+' '+(Date.now()-started)+'ms');}
 function finish(err,obj){if(done)return;if(mode==='/stream')log(err?'Error '+stage+': '+err:'Stream complete');done=true;clearTimeout(timer);if(secure)secure.destroy();if(sock)sock.destroy();if(request)request.abort();if(stream){if(err)res.destroy();else res.end();return;}var out=err?{error:err,stage:stage}:obj;out.trace=trace;res.end(JSON.stringify(out));}
 mark(stage);timer=setTimeout(function(){finish('Timeout');},30000);
 res.on('close',function(){if(!done)finish('Client closed');});
 function tunnel(s){
 sock=s;mark('TLS handshake');
 try{
 secure=tls.connect({socket:s,host:target,servername:target,rejectUnauthorized:true},function(){
 mark('HTTPS request');
 secure.write((mode==='/api'?'POST':'GET')+' '+path+' HTTP/1.0\r\nHost: '+target+'\r\nUser-Agent: '+ua+'\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n'+(mode==='/media'?'Range: bytes=0-262143\r\n':mode==='/stream'&&rangeRequest?'Range: '+rangeRequest+'\r\n':'')+(mode==='/api'?'Content-Type: application/json\r\nContent-Length: '+payload.length+'\r\n':'')+'\r\n');if(mode==='/api')secure.write(payload);
 });
 var data='',header=null,bytes=0,parts=[],status=0,type='',range=false,expected=0;
 function report(){finish(null,{status:status,bytes:bytes,ms:Date.now()-started,range:range,type:type,page:mode==='/ytbody'?((/<title[^>]*>([^<]*)<\/title>/i.exec(Buffer.concat(parts).toString())||[])[1]||'Title not found'):undefined});}
 secure.on('error',function(e){finish(e.message);});
 secure.on('data',function(c){
 if(done)return;
 if(header===null){data+=c.toString('binary');var split=data.indexOf('\r\n\r\n');if(split<0){if(data.length>32768)finish('Headers too large');return;}header=data.slice(0,split);c=new Buffer(data.slice(split+4),'binary');data='';status=Number((/^HTTP\/1\.[01] (\d+)/.exec(header)||[])[1]);type=(/\r\ncontent-type:\s*([^\r\n]+)/i.exec(header)||[])[1]||'';range=/\r\ncontent-range:/i.test(header);mark('HTTP '+status);
 if(mode==='/youtube')return report();
 if(mode==='/stream'){
 log('Upstream '+status+' '+type);
 if((status!==200&&status!==206)||!/^video\/mp4/i.test(type))return finish('Stream unavailable: HTTP '+status+' '+type);
 if(/\r\ntransfer-encoding:/i.test(header))return finish('Unsupported upstream transfer encoding');
 var len=(/\r\ncontent-length:\s*(\d+)/i.exec(header)||[])[1],cr=(/\r\ncontent-range:\s*([^\r\n]+)/i.exec(header)||[])[1];
 if(!len||Number(len)>64*1024*1024|| (status===206&&!cr))return finish('Invalid stream length or range');
 res.statusCode=status;res.setHeader('Content-Type',type);res.setHeader('Content-Length',len);res.setHeader('Accept-Ranges','bytes');if(cr)res.setHeader('Content-Range',cr);
 expected=Number(len);log('Length '+len+' Range '+(cr||'none'));stream=true;if(req.method==='HEAD')return finish(null,{});clearTimeout(timer);timer=setTimeout(function(){finish('Stream timeout');},120000);
 }

 if(mode==='/play'&&(status!==200||!/^video\/mp4/i.test(type)))return finish('Video unavailable: HTTP '+status+' '+type);
 }
 bytes+=c.length;if(mode==='/stream'){if(!res.write(c)){secure.pause();res.once('drain',function(){if(!done)secure.resume();});}return;}
 if(mode==='/ytbody'||mode==='/ytpage'||mode==='/ytasset'||mode==='/ytthumb'||mode==='/view'||mode==='/resource'||mode==='/api'){parts.push(c);if(bytes>8*1024*1024)return finish('Asset too large');if(mode==='/ytbody'&&bytes>=16384)return report();}
 if(mode==='/test'||mode==='/play')parts.push(c);
 if(mode==='/test'&&bytes>8192)return finish('Response too large');
 if(mode==='/play'&&bytes>4*1024*1024)return finish('Video too large');
 if(mode==='/media'&&bytes>=262144)return report();
 });
 secure.on('end',function(){
 if(done)return;if(header===null)return finish('No HTTP response');
 if(mode==='/stream')return finish(bytes===expected?null:'Incomplete response '+bytes+'/'+expected,{});
 if(mode==='/api'){var b=Buffer.concat(parts);log('API '+path.split('?')[0]+' HTTP '+status);if(!/^application\/json/i.test(type))return finish('API response not JSON: '+status);res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Content-Length',b.length);stream=true;res.write(b);return finish(null,{});}
 if(mode==='/view'||mode==='/resource'){
 var b=Buffer.concat(parts);log(mode+' HTTP '+status+' '+bytes+' bytes');
 if(status!==200)return finish('Upstream HTTP '+status);
 if(mode==='/view'){
 if(!/^text\/html/i.test(type))return finish('Not HTML');
 var token=encodeURIComponent(String(q.query.ticket)),prefix='http://127.0.0.1:'+port+'/resource?ticket='+token+'&asset=';
 function asset(raw){try{var u=url.resolve('https://www.youtube.com/tv',raw.replace(/&amp;/g,'&')),a=url.parse(u);if(a.protocol==='https:'&&['www.youtube.com','www.gstatic.com','s.ytimg.com','i.ytimg.com','youtube.com','fonts.googleapis.com','fonts.gstatic.com'].indexOf(a.hostname)>=0&&/\.(js|css|png|jpg|jpeg|webp|woff2?|svg)$/i.test(a.pathname||''))return prefix+encodeURIComponent(u);}catch(e){}return raw;}
 var html=b.toString().replace(/<base\b[^>]*>/gi,'').replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi,'').replace(/<(script|link|img)\b[^>]*>/gi,function(tag){return tag.replace(/\b(src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi,function(_,k,a,b,c){return k+'="'+asset(a||b||c).replace(/"/g,'&quot;')+'"';});});
 var shim="(function(){var base=BASE;var X=XMLHttpRequest.prototype,open=X.open,send=X.send,header=X.setRequestHeader;\nfunction route(u){try{var a=document.createElement('a');a.href=u;if(/^\\//.test(u)&&!/^\\/\\//.test(u))a.href='https://www.youtube.com'+u;if(a.hostname==='www.youtube.com'&&/^\\/youtubei\\/v1\\/(browse|next|search|guide|player)$/.test(a.pathname))return base+encodeURIComponent(a.href);}catch(e){}return null;}\nX.open=function(m,u){var p=String(m).toUpperCase()==='POST'&&route(String(u));this._thApi=!!p;if(p){arguments[1]=p;}return open.apply(this,arguments);};\nX.setRequestHeader=function(k,v){if(this._thApi&&String(k).toLowerCase()!=='content-type')return;return header.apply(this,arguments);};\nX.send=function(b){if(this._thApi){this.withCredentials=false;}return send.apply(this,arguments);};\nif(window.fetch){var f=window.fetch;window.fetch=function(u,o){var p=o&&String(o.method).toUpperCase()==='POST'&&route(String(u));if(p)return f.call(window,p,{method:'POST',body:o.body,headers:{'Content-Type':'application/json'},credentials:'omit'});return f.apply(window,arguments);};}\n})();".replace('BASE',JSON.stringify('http://127.0.0.1:'+port+'/api?ticket='+token+'&asset='));html=html.replace(/<head[^>]*>/i,function(t){return t+'<script>'+shim+'</script>';});
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:"+port+"; style-src 'unsafe-inline' http://127.0.0.1:"+port+"; img-src data: http://127.0.0.1:"+port+"; font-src data: http://127.0.0.1:"+port+"; connect-src http://127.0.0.1:"+port+"; frame-src 'none'; form-action 'none'; base-uri 'none'");
 b=new Buffer(html);type='text/html; charset=utf-8';
 }else if(!/^(application\/(javascript|x-javascript|font-woff|octet-stream)|text\/(javascript|css)|image\/|font\/)/i.test(type))return finish('Unsupported asset type');
 res.setHeader('Content-Type',type);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Length',b.length);stream=true;res.write(b);return finish(null,{});
 }
 if(mode==='/ytasset'||mode==='/ytthumb'||mode==='/ytpage'){
 var body=Buffer.concat(parts);
 if(status!==200)return finish('Upstream HTTP '+status);
 if(mode==='/ytthumb'){if(!/^image\/(jpeg|png|webp)/i.test(type))return finish('Not an image: '+type);return finish(null,{status:status,bytes:bytes,type:type,image:'data:'+type.split(';')[0]+';base64,'+body.toString('base64')});}
 if(mode==='/ytasset')return finish(null,{status:status,bytes:bytes,type:type,ms:Date.now()-started});
 var html=body.toString(),assets=[],m,allowed=['www.youtube.com','www.gstatic.com','s.ytimg.com','i.ytimg.com','youtube.com','fonts.googleapis.com','fonts.gstatic.com'];
 function add(raw){try{raw=raw.replace(/\\\//g,'/').replace(/\\u0026/g,'&').replace(/&amp;/g,'&');var u=url.resolve('https://www.youtube.com/tv',raw),a=url.parse(u);if(a.protocol==='https:'&&!a.auth&&!a.port&&allowed.indexOf(a.hostname)>=0&&/\.(js|css)(?:$|\/)/i.test(a.pathname||'')&&assets.indexOf(u)<0&&assets.length<20)assets.push(u);}catch(e){}}
 var re=/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
 while((m=re.exec(html)))add(m[1]||m[2]||m[3]);
 re=/(?:https?:\/\/|\/\/|\/)[^"'<> \t\r\n\\]+?\.(?:js|css)(?:\?[^"'<> \t\r\n\\]*)?/gi;
 while((m=re.exec(html)))add(m[0]);
 var markers=[];['script','iframe','unsupported','consent','redirect','location','ytcfg','bootstrap','polymer','error'].forEach(function(k){if(html.toLowerCase().indexOf(k)>=0)markers.push(k);});
 var sample=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' [script] ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,350);
 return finish(null,{status:status,bytes:bytes,type:type,page:((/<title[^>]*>([^<]*)<\/title>/i.exec(html)||[])[1]||'Unknown'),assets:assets,markers:markers,sample:sample});
 }
 if(mode==='/test'){var ip=Buffer.concat(parts).toString().trim();if(status!==200||!net.isIP(ip))return finish('Invalid IP response');return finish(null,{ip:ip});}
 if(mode==='/play'){var body=Buffer.concat(parts);if(!body.length)return finish('Empty video');stream=true;res.setHeader('Content-Type','video/mp4');res.setHeader('Content-Length',body.length);res.write(body);return finish(null,{});}
 report();
 });
 }catch(e){finish(e.message);}
 }
 var payload=new Buffer(0);function start(){try{
 if(socks){
 sock=net.connect(p,host,function(){mark('SOCKS greeting');sock.write(new Buffer([5,1,0]));});
 var buf=new Buffer(0),phase=0;
 function read(c){buf=Buffer.concat([buf,c]);if(phase===0){if(buf.length<2)return;if(buf[0]!==5||buf[1]!==0)return finish('SOCKS auth rejected');buf=buf.slice(2);phase=1;mark('SOCKS CONNECT');var name=new Buffer(target);sock.write(Buffer.concat([new Buffer([5,1,0,3,name.length]),name,new Buffer([1,187])]));}
 if(phase===1){if(buf.length<5)return;if(buf[0]!==5||buf[1]!==0)return finish('SOCKS reply '+buf[1]);var n=buf[3]===1?10:buf[3]===4?22:buf[3]===3?7+buf[4]:0;if(!n)return finish('SOCKS address type');if(buf.length<n)return;sock.removeListener('data',read);if(buf.length>n)sock.unshift(buf.slice(n));tunnel(sock);}}
 sock.on('data',read);sock.on('error',function(e){finish(e.message);});
 }else{
 request=http.request({host:host,port:p,method:'CONNECT',path:target+':443',headers:{Host:target+':443'}});
 request.on('socket',function(s){s.on('connect',function(){mark('HTTP CONNECT');});});
 request.on('error',function(e){finish(e.message);});
 request.on('connect',function(r,s,head){sock=s;s.on('error',function(e){finish(e.message);});if(r.statusCode!==200)return finish('CONNECT HTTP '+r.statusCode);if(head.length)s.unshift(head);tunnel(s);});request.end();
 }
 }catch(e){finish(e.message);}}
 if(mode==='/api'){req.on('data',function(c){if(done)return;payload=Buffer.concat([payload,c]);if(payload.length>1048576)finish('API body too large');});req.on('end',function(){if(done)return;try{var data=JSON.parse(payload.toString());if(!data||typeof data!=='object')throw Error('Invalid JSON');}catch(e){return finish('Invalid JSON');}start();});}else start();
}
try{var server=process.__tizenHomeV9;if(server){server.removeAllListeners('request');server.on('request',handler);}else{server=http.createServer(handler);server.on('error',function(){});server.on('clientError',function(e,s){s.destroy();});server.listen(port,'127.0.0.1');process.__tizenHomeV9=server;}}catch(e){}
