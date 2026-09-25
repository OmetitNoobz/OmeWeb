/**
 * OmeRyth Web - Storage & Cookie Consent Manager
 * Gestion de la conformité des cookies, du consentement utilisateur et
 * de la persistance locale complète (bande rythmo, pistes, répliques, repères et vidéo) via IndexedDB.
 */

export class StorageManager {
  static COOKIE_CONSENT_KEY = 'omeryth_cookie_consent';
  static DB_NAME = 'OmeRythStorage';
  static DB_VERSION = 1;
  static STORE_NAME = 'session_data';

  /**
   * Retourne le statut actuel du consentement : 'accepted', 'declined' ou null (non défini)
   */
  static getConsentStatus() {
    try {
      return localStorage.getItem(StorageManager.COOKIE_CONSENT_KEY);
    } catch (_) {
      return null;
    }
  }

  /**
   * Enregistre le choix de l'utilisateur ('accepted' ou 'declined')
   */
  static setConsentStatus(status) {
    try {
      if (status === 'accepted' || status === 'declined') {
        localStorage.setItem(StorageManager.COOKIE_CONSENT_KEY, status);
      } else {
        localStorage.removeItem(StorageManager.COOKIE_CONSENT_KEY);
      }
    } catch (_) {}

    // Si l'utilisateur refuse, on supprime immédiatement toutes les données locales
    if (status === 'declined') {
      StorageManager.clearSession();
    }
  }

  /**
   * Indique si l'utilisateur a explicitement accepté les cookies et la sauvegarde
   */
  static hasConsent() {
    return StorageManager.getConsentStatus() === 'accepted';
  }

  /**
   * Ouvre ou initialise la base de données IndexedDB OmeRyth
   */
  static openDB() {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB non supporté par ce navigateur'));
        return;
      }

      const request = indexedDB.open(StorageManager.DB_NAME, StorageManager.DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(StorageManager.STORE_NAME)) {
          db.createObjectStore(StorageManager.STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Sauvegarde la session complète dans IndexedDB (projet rythmo + vidéo Blob/File)
   * Uniquement exécuté si hasConsent() est vrai.
   */
  static async saveSession(sessionData) {
    if (!StorageManager.hasConsent()) {
      return false;
    }

    try {
      const db = await StorageManager.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(StorageManager.STORE_NAME, 'readwrite');
        const store = tx.objectStore(StorageManager.STORE_NAME);

        const record = {
          id: 'current_session',
          timestamp: Date.now(),
          ...sessionData
        };

        const req = store.put(record);

        req.onsuccess = () => resolve(true);

        req.onerror = () => {
          // Gestion de sécurité en cas de QuotaExceededError (très gros fichier vidéo)
          if (record.videoBlob) {
            console.warn('[StorageManager] Quota dépassé pour la vidéo, sauvegarde de la bande rythmo seule.');
            record.videoBlob = null;
            record.videoQuotaExceeded = true;
            try {
              const retryTx = db.transaction(StorageManager.STORE_NAME, 'readwrite');
              retryTx.objectStore(StorageManager.STORE_NAME).put(record);
              resolve(true);
              return;
            } catch (_) {}
          }
          reject(req.error);
        };
      });
    } catch (err) {
      console.warn('[StorageManager] Erreur lors de la sauvegarde :', err);
      return false;
    }
  }

  /**
   * Charge la session sauvegardée depuis IndexedDB
   * Retourne null si aucun consentement ou aucune session trouvée.
   */
  static async loadSession() {
    if (!StorageManager.hasConsent()) {
      return null;
    }

    try {
      const db = await StorageManager.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(StorageManager.STORE_NAME, 'readonly');
        const store = tx.objectStore(StorageManager.STORE_NAME);
        const req = store.get('current_session');

        req.onsuccess = () => {
          resolve(req.result || null);
        };

        req.onerror = () => {
          reject(req.error);
        };
      });
    } catch (err) {
      console.warn('[StorageManager] Erreur lors du chargement de la session :', err);
      return null;
    }
  }

  /**
   * Supprime complètement les données de session stockées dans IndexedDB
   */
  static async clearSession() {
    try {
      const db = await StorageManager.openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(StorageManager.STORE_NAME, 'readwrite');
        const store = tx.objectStore(StorageManager.STORE_NAME);
        const req = store.delete('current_session');
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      });
    } catch (_) {
      return false;
    }
  }
}
