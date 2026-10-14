import Database from 'better-sqlite3'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {hash,sessionLifetime} from '../../src/server/lib/security.js'
import {passwordHash} from '../../src/server/lib/accounts.js'
const sessions=new Map();let encoded
export const fixtureAccountCookie=id=>sessions.get(id)||''
export async function fixtureAccount(directory=process.env.DATA_DIR){
 encoded ||= passwordHash('Fixture-password-123!')
 const id='account_'+randomBytes(16).toString('hex'),token=randomBytes(32).toString('hex'),db=new Database(path.join(directory,'netaxis.sqlite'))
 try{db.prepare('INSERT INTO netaxis_accounts VALUES (?,?,?,?)').run(id,id+'@example.test',await encoded,randomBytes(32).toString('hex'));db.prepare('INSERT INTO netaxis_account_sessions VALUES (?,?,?)').run(hash(token),id,Date.now()+sessionLifetime)}finally{db.close()}
 const cookie='netaxis-account='+token;sessions.set(id,cookie);return{id,cookie}
}
