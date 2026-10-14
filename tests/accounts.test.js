import test, {after} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {io} from 'socket.io-client'
import {captchaFetch} from './helpers/captcha.js'
import {hash} from '../src/server/lib/security.js'
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'netaxis-accounts-'))
Object.assign(process.env,{DATA_DIR:directory,PORT:'0',HOST:'127.0.0.1',NODE_ENV:'test',PUBLIC_ORIGIN:''})
const {httpServer,closeServer,cleanupSessions}=await import('../src/server/index.js')
const {db}=await import('../src/server/db.js')
if(!httpServer.listening)await new Promise(resolve=>httpServer.once('listening',resolve))
const base='http://127.0.0.1:'+httpServer.address().port
const password='My-private-password-123!'
async function request(url,method='GET',body,cookie='',extra={}){
 const res=await fetch(base+'/api'+url,{method,headers:{'Content-Type':'application/json',cookie,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})})
 return {status:res.status,body:res.status===204?null:await res.json(),cookie:res.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>c.startsWith('netaxis-account=')).join('; '),headers:res.headers}
}
after(async()=>{await closeServer();fs.rmSync(directory,{recursive:true,force:true})})
test('real signup and login preserve permanent private rooms across sessions; logout revokes sockets',async()=>{
 assert.equal((await request('/rooms')).status,401)
 assert.equal((await request('/auth/register','POST',{email:'bad',password:'short'})).status,400)
 const owner=await request('/auth/register','POST',{email:' OWNER@example.test ',password})
 assert.equal(owner.status,201);assert.equal(owner.body.user.email,'owner@example.test')
 assert.match(owner.headers.get('set-cookie'),/HttpOnly/);assert.match(owner.headers.get('set-cookie'),/SameSite=Strict/)
 const stored=db.prepare('SELECT * FROM netaxis_accounts WHERE id=?').get(owner.body.user.id)
 assert.match(stored.password_hash,/^scrypt:/);assert.equal(stored.password_hash.includes(password),false)
 assert.equal(db.prepare('SELECT token_hash FROM netaxis_account_sessions').get().token_hash,hash(owner.cookie.split('=')[1]))
 assert.equal((await request('/auth/register','POST',{email:'owner@example.test',password})).status,409)
 const creation=await captchaFetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json',cookie:owner.cookie},body:JSON.stringify({name:'Private permanent lab',displayName:'Owner'})},directory)
 const room=await creation.json();assert.equal(creation.status,201);assert.equal(room.room.expiresAt,null)
 assert.equal(room.sessionId,owner.body.user.id);assert.equal(JSON.stringify(room).includes(stored.membership_token),false)
 const other=await request('/auth/register','POST',{email:'other@example.test',password})
 assert.deepEqual((await request('/rooms','GET',undefined,other.cookie)).body.rooms,[])
 assert.equal((await request('/rooms/'+room.room.id,'GET',undefined,other.cookie,{'x-session-id':stored.membership_token})).status,401)
 assert.equal((await request('/rooms/'+room.room.id,'DELETE',undefined,other.cookie,{'x-session-id':owner.body.user.id})).status,401)
 const socket=io(base,{auth:{roomId:room.room.id,sessionId:room.sessionId},extraHeaders:{Cookie:owner.cookie},transports:['websocket'],reconnection:false})
 try{
  await new Promise((resolve,reject)=>{socket.once('room:sync',resolve);socket.once('connect_error',reject);setTimeout(()=>reject(Error('Socket sync timed out')),3000).unref()})
  const disconnected=new Promise(resolve=>socket.once('disconnect',resolve))
  assert.equal((await request('/auth/logout','POST',{},owner.cookie)).status,204);await disconnected
 }finally{socket.disconnect()}
 assert.equal((await request('/rooms','GET',undefined,owner.cookie)).status,401)
 assert.equal((await request('/auth/login','POST',{email:'owner@example.test',password:'Incorrect-password-123!'})).status,401)
 const relogin=await request('/auth/login','POST',{email:'owner@example.test',password})
 assert.equal(relogin.status,200);assert.notEqual(relogin.cookie,owner.cookie)
 assert.equal((await request('/rooms','GET',undefined,relogin.cookie)).body.rooms[0].id,room.room.id)
 assert.equal((await request('/rooms/'+room.room.id+'/resume','POST',{},relogin.cookie)).body.participant.role,'owner')
 const secondDevice=await request('/auth/login','POST',{email:'owner@example.test',password})
 assert.equal((await request('/rooms','GET',undefined,secondDevice.cookie)).body.rooms[0].id,room.room.id)
 assert.equal((await request('/auth/me','GET',undefined,relogin.cookie)).body.user.id,owner.body.user.id)
 db.prepare('UPDATE netaxis_account_sessions SET expires_at=0 WHERE token_hash=?').run(hash(secondDevice.cookie.split('=')[1]))
 cleanupSessions();assert.equal((await request('/rooms','GET',undefined,secondDevice.cookie)).status,401)
 assert.equal((await request('/rooms/'+room.room.id,'DELETE',undefined,relogin.cookie)).status,204)
 assert.deepEqual((await request('/rooms','GET',undefined,relogin.cookie)).body.rooms,[])
})
