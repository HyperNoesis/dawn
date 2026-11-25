/**
 * AuthProvider — interface contract, both implementations return Promises
 * so the app works identically whether accounts are local or real:
 *
 *   async signUp(name, email, password) -> { name, email, needsConfirmation }
 *   async signIn(email, password) -> { name, email }
 *   async signOut() -> void
 *   async getCurrentUser() -> { name, email } | null
 *   async updateProfile(newName) -> void
 *   async updatePassword(newPassword, currentPassword?) -> void
 *   async resetPassword(email) -> void   (sends/handles a reset — see per-provider notes)
 *   async deleteAccount() -> void
 */

class LocalAuthProvider {
  constructor() {
    this.USERS_KEY = 'vs_users';
    this.SESSION_KEY = 'vs_session';
  }

  async _hash(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  _getUsers() { return JSON.parse(localStorage.getItem(this.USERS_KEY) || '{}'); }
  _saveUsers(u) { localStorage.setItem(this.USERS_KEY, JSON.stringify(u)); }
  _getSession() { return JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null'); }

  async signUp(name, email, password) {
    email = email.trim().toLowerCase();
    if (!name || !email || !password) throw new Error('Name, email, and password are all required.');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    const users = this._getUsers();
    if (users[email]) throw new Error('An account with that email already exists on this device.');
    users[email] = { name, passwordHash: await this._hash(password), createdAt: Date.now() };
    this._saveUsers(users);
    localStorage.setItem(this.SESSION_KEY, JSON.stringify({ email }));
    return { name, email, needsConfirmation: false };
  }

  async signIn(email, password) {
    email = email.trim().toLowerCase();
    const users = this._getUsers();
    const user = users[email];
    if (!user || user.passwordHash !== (await this._hash(password))) {
      throw new Error('Incorrect email or password.');
    }
    localStorage.setItem(this.SESSION_KEY, JSON.stringify({ email }));
    return { name: user.name, email };
  }

  async getAccessToken() { return null; }

  async signOut() {
    localStorage.removeItem(this.SESSION_KEY);
  }

  async getCurrentUser() {
    const session = this._getSession();
    if (!session) return null;
    const users = this._getUsers();
    const user = users[session.email];
    if (!user) return null;
    return { name: user.name, email: session.email };
  }

  async updateProfile(newName) {
    const session = this._getSession();
    if (!session) return;
    const users = this._getUsers();
    if (users[session.email]) {
      users[session.email].name = newName;
      this._saveUsers(users);
    }
  }

  async updatePassword(newPassword, currentPassword) {
    const session = this._getSession();
    if (!session) throw new Error('You must be signed in.');
    if (!newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters.');
    const users = this._getUsers();
    const user = users[session.email];
    if (!user) throw new Error('Account not found on this device.');
    if (user.passwordHash !== (await this._hash(currentPassword || ''))) {
      throw new Error('Current password is incorrect.');
    }
    user.passwordHash = await this._hash(newPassword);
    this._saveUsers(users);
  }

  async resetPassword() {
    // No email infrastructure for a device-local account — there's nothing
    // to send a reset link to. Honest about the limitation rather than
    // pretending to send an email that never arrives.
    throw new Error('Password reset by email needs a cloud account. Accounts on this device cannot be reset that way. Sign in with your existing password, or continue as a guest.');
  }

  async deleteAccount() {
    const session = this._getSession();
    if (!session) return;
    const users = this._getUsers();
    delete users[session.email];
    this._saveUsers(users);
    localStorage.removeItem(this.SESSION_KEY);
  }
}

/**
 * Real, cross-device accounts via Supabase Auth. Requires the Supabase JS
 * CDN script and a filled-in js/config.js (see docs/DEPLOY.md).
 */
class SupabaseAuthProvider {
  constructor(url, anonKey) {
    if (typeof window.supabase === 'undefined') {
      throw new Error('Supabase JS client not loaded — check the script tag in <head>.');
    }
    this.client = window.supabase.createClient(url, anonKey);
  }

  async signUp(name, email, password) {
    const { data, error } = await this.client.auth.signUp({
      email, password, options: { data: { name } }
    });
    if (error) throw new Error(error.message);
    // If email confirmation is required (project default), there's no
    // session yet — auth.uid() is unresolved for RLS, so the profile row
    // can't be written now. signIn() below upserts it once they're actually
    // authenticated, so this never gets permanently skipped.
    if (data.session && data.user) {
      await this.client.from('profiles').upsert({ id: data.user.id, name, email });
    }
    return { name, email, needsConfirmation: !data.session };
  }

  async signIn(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    // Ensure a profiles row exists even if signUp couldn't write one
    // earlier (email-confirmation-pending case above).
    const name = data.user.user_metadata?.name || email;
    await this.client.from('profiles').upsert({ id: data.user.id, name, email: data.user.email }).select().maybeSingle().catch(() => {});
    return { name, email };
  }

  async getAccessToken() {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw new Error(error.message);
    return data && data.session ? data.session.access_token : null;
  }

  async signOut() {
    await this.client.auth.signOut();
  }

  async getCurrentUser() {
    const { data: { session } } = await this.client.auth.getSession();
    if (!session) return null;
    return { name: session.user.user_metadata?.name || session.user.email, email: session.user.email };
  }

  async updateProfile(newName) {
    await this.client.auth.updateUser({ data: { name: newName } });
    const { data: { session } } = await this.client.auth.getSession();
    if (session) await this.client.from('profiles').update({ name: newName }).eq('id', session.user.id);
  }

  async updatePassword(newPassword) {
    if (!newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters.');
    const { error } = await this.client.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  }

  async resetPassword(email) {
    const { error } = await this.client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}reset-password.html`,
    });
    if (error) throw new Error(error.message);
  }

  async deleteAccount() {
    // Storage objects are external blobs and do not cascade with auth.users.
    // Enumerate only this authenticated user's own prefix, remove via the
    // Supabase Storage API, then delete the metadata/account through the
    // SECURITY DEFINER function. Never delete storage.objects rows with SQL.
    const { data: sessionData, error: sessionError } = await this.client.auth.getSession();
    if (sessionError) throw new Error('Could not verify your account session: ' + sessionError.message);
    const userId = sessionData && sessionData.session && sessionData.session.user && sessionData.session.user.id;
    if (!userId) throw new Error('You must be signed in to delete your account.');

    const MAX_OBJECTS = 10000;
    const PAGE_SIZE = 500;
    const CHUNK_SIZE = 100;
    for (const bucket of ['recordings', 'environments']) {
      const paths = [];
      const collect = async (prefix, depth) => {
        if (depth > 5) throw new Error('Storage folder nesting exceeded the safe account-cleanup limit.');
        let offset = 0;
        for (;;) {
          const { data, error } = await this.client.storage.from(bucket).list(prefix, {
            limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' }
          });
          if (error) throw new Error('Could not inspect your ' + bucket + ' files: ' + error.message);
          const items = data || [];
          for (const item of items) {
            if (!item || !item.name || item.name === '.' || item.name === '..') continue;
            const path = prefix + '/' + item.name;
            if (item.id || item.metadata) {
              paths.push(path);
              if (paths.length > MAX_OBJECTS) {
                throw new Error('This account has more than 10,000 stored objects. Contact support for assisted deletion; your account has not been deleted.');
              }
            } else {
              await collect(path, depth + 1);
            }
          }
          if (items.length < PAGE_SIZE) break;
          offset += items.length;
        }
      };
      await collect(userId, 0);
      for (let i = 0; i < paths.length; i += CHUNK_SIZE) {
        const { error } = await this.client.storage.from(bucket).remove(paths.slice(i, i + CHUNK_SIZE));
        if (error) throw new Error('Could not safely remove your ' + bucket + ' files: ' + error.message + '. Your account has not been deleted.');
      }
    }

    const { error } = await this.client.rpc('delete_own_account');
    if (error) throw new Error('Storage was cleaned, but account deletion failed: ' + error.message);
    await this.client.auth.signOut();
  }
}

window.VS = window.VS || {};
window.VS.LocalAuthProvider = LocalAuthProvider;
window.VS.SupabaseAuthProvider = SupabaseAuthProvider;
