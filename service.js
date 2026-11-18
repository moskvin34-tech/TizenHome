var http=require('http'),tls=require('tls'),net=require('net'),url=require('url');
var port=8094;
function handler(req,res){
 var origin=req.headers.origin;
 if(['127.0.0.1:'+port,'localhost:'+port].indexOf(req.headers.host)<0 || ['http://127.0.0.1:8081','http://localhost:8081'].indexOf(origin)<0){res.writeHead(403);return res.end();}
 res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/json');
 var q=url.parse(req.url,true);
 if(req.method!=='GET'){res.statusCode=405;return res.end();}
 if(q.pathname==='/health')return res.end(JSON.stringify({ok:true}));
 var host=String(q.query.host||''),p=Number(q.query.port);
 if(q.pathname!=='/test'||net.isIP(host)!==4||! /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host)||!isFinite(p)||p<1||p>65535||p%1){res.statusCode=400;return res.end(JSON.stringify({error:'Invalid private IPv4 or port'}));}
 var done=false,sock,secure,request,timer;
 function finish(err,ip){if(done)return;done=true;clearTimeout(timer);if(secure)secure.destroy();if(sock)sock.destroy();if(request)request.abort();res.end(JSON.stringify(err?{error:err}:{ip:ip}));}
 timer=setTimeout(function(){finish('Timeout');},15000);
 try{
 request=http.request({host:host,port:p,method:'CONNECT',path:'api.ipify.org:443',headers:{Host:'api.ipify.org:443'}});
 request.on('error',function(e){finish(e.message);});
 request.on('connect',function(r,s,head){
 sock=s;sock.on('error',function(e){finish(e.message);});
 if(r.statusCode!==200)return finish('CONNECT HTTP '+r.statusCode);
 if(head.length)s.unshift(head);
 try{
 secure=tls.connect({socket:s,host:'api.ipify.org',servername:'api.ipify.org',rejectUnauthorized:true},function(){
 secure.write('GET / HTTP/1.0\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n');
 });
 var data='';
 secure.on('error',function(e){finish(e.message);});
 secure.on('data',function(c){data+=c.toString();if(data.length>8192)finish('Response too large');});
 secure.on('end',function(){var split=data.indexOf('\r\n\r\n'),ip=data.slice(split+4).trim();if(split<0||!/^HTTP\/1\.[01] 200 /.test(data)||!net.isIP(ip))return finish('Invalid IP response');finish(null,ip);});
 }catch(e){finish(e.message);}
 });
 request.end();
 }catch(e){finish(e.message);}
}
try{var server=process.__tizenHomeDiagnostic;if(server){server.removeAllListeners('request');server.on('request',handler);}else{server=http.createServer(handler);server.on('error',function(){});server.on('clientError',function(e,s){s.destroy();});server.listen(port,'127.0.0.1');process.__tizenHomeDiagnostic=server;}}catch(e){}
