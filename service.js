var http=require('http'),tls=require('tls'),net=require('net'),url=require('url');
var port=8095;
function handler(req,res){
 var origin=req.headers.origin,q=url.parse(req.url,true);
 if(['127.0.0.1:'+port,'localhost:'+port].indexOf(req.headers.host)<0 || ['http://127.0.0.1:8081','http://localhost:8081'].indexOf(origin)<0){res.writeHead(403);return res.end();}
 res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/json');
 if(req.method!=='GET'){res.statusCode=405;return res.end();}
 if(q.pathname==='/health')return res.end(JSON.stringify({ok:true,version:'0.3.0'}));
 var host=String(q.query.host||''),p=Number(q.query.port),mode=q.pathname,socks=q.query.proto==='socks';
 if(['/test','/youtube','/media','/play'].indexOf(mode)<0||net.isIP(host)!==4||! /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host)||!isFinite(p)||p<1||p>65535||p%1){res.statusCode=400;return res.end(JSON.stringify({error:'Invalid private IPv4 or port'}));}
 var media=mode==='/media'||mode==='/play',target=mode==='/youtube'?'www.youtube.com':media?'interactive-examples.mdn.mozilla.net':'api.ipify.org';
 var path=mode==='/youtube'?'/tv':media?'/media/cc0-videos/flower.mp4':'/';
 var done=false,sock,secure,request,timer,started=Date.now(),stage='TCP to proxy',trace=[],stream=false;
 function mark(x){stage=x;trace.push(x+' '+(Date.now()-started)+'ms');}
 function finish(err,obj){if(done)return;done=true;clearTimeout(timer);if(secure)secure.destroy();if(sock)sock.destroy();if(request)request.abort();if(stream){res.end();return;}var out=err?{error:err,stage:stage}:obj;out.trace=trace;res.end(JSON.stringify(out));}
 mark(stage);timer=setTimeout(function(){finish('Timeout');},30000);
 res.on('close',function(){if(!done)finish('Client closed');});
 function tunnel(s){
 sock=s;mark('TLS handshake');
 try{
 secure=tls.connect({socket:s,host:target,servername:target,rejectUnauthorized:true},function(){
 mark('HTTPS request');
 secure.write('GET '+path+' HTTP/1.0\r\nHost: '+target+'\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n'+(mode==='/media'?'Range: bytes=0-262143\r\n':'')+'\r\n');
 });
 var data='',header=null,bytes=0,parts=[],status=0,type='',range=false;
 function report(){finish(null,{status:status,bytes:bytes,ms:Date.now()-started,range:range,type:type});}
 secure.on('error',function(e){finish(e.message);});
 secure.on('data',function(c){
 if(done)return;
 if(header===null){data+=c.toString('binary');var split=data.indexOf('\r\n\r\n');if(split<0){if(data.length>32768)finish('Headers too large');return;}header=data.slice(0,split);c=new Buffer(data.slice(split+4),'binary');data='';status=Number((/^HTTP\/1\.[01] (\d+)/.exec(header)||[])[1]);type=(/\r\ncontent-type:\s*([^\r\n]+)/i.exec(header)||[])[1]||'';range=/\r\ncontent-range:/i.test(header);mark('HTTP '+status);
 if(mode==='/youtube')return report();
 if(mode==='/play'&&(status!==200||!/^video\/mp4/i.test(type)))return finish('Video unavailable: HTTP '+status+' '+type);
 }
 bytes+=c.length;if(mode==='/test'||mode==='/play')parts.push(c);
 if(mode==='/test'&&bytes>8192)return finish('Response too large');
 if(mode==='/play'&&bytes>4*1024*1024)return finish('Video too large');
 if(mode==='/media'&&bytes>=262144)return report();
 });
 secure.on('end',function(){
 if(done)return;if(header===null)return finish('No HTTP response');
 if(mode==='/test'){var ip=Buffer.concat(parts).toString().trim();if(status!==200||!net.isIP(ip))return finish('Invalid IP response');return finish(null,{ip:ip});}
 if(mode==='/play'){var body=Buffer.concat(parts);if(!body.length)return finish('Empty video');stream=true;res.setHeader('Content-Type','video/mp4');res.setHeader('Content-Length',body.length);res.write(body);return finish(null,{});}
 report();
 });
 }catch(e){finish(e.message);}
 }
 try{
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
 }catch(e){finish(e.message);}
}
try{var server=process.__tizenHomeV3;if(server){server.removeAllListeners('request');server.on('request',handler);}else{server=http.createServer(handler);server.on('error',function(){});server.on('clientError',function(e,s){s.destroy();});server.listen(port,'127.0.0.1');process.__tizenHomeV3=server;}}catch(e){}
