// frontend/src/App.js
import React, { useState, useEffect, useRef } from 'react';
import { Amplify, Auth } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import axios from 'axios';
import './App.css';

// 設定を読み込む関数
const loadConfig = () => {
  // ウィンドウオブジェクトから設定を取得
  if (window.REACT_APP_CONFIG) {
    return {
      apiEndpoint: window.REACT_APP_CONFIG.apiEndpoint,
      userPoolId: window.REACT_APP_CONFIG.userPoolId,
      userPoolClientId: window.REACT_APP_CONFIG.userPoolClientId,
      region: window.REACT_APP_CONFIG.region,
    };
  }
  
  // 環境変数から設定を取得（ローカル開発用）
  return {
    apiEndpoint: process.env.REACT_APP_API_ENDPOINT || 'YOUR_API_ENDPOINT',
    userPoolId: process.env.REACT_APP_USER_POOL_ID || 'YOUR_USER_POOL_ID',
    userPoolClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID || 'YOUR_USER_POOL_CLIENT_ID',
    region: process.env.REACT_APP_REGION || 'us-east-1',
  };
};

// 設定を取得
const config = loadConfig();

// Amplify設定
Amplify.configure({
  Auth: {
    region: config.region,
    userPoolId: config.userPoolId,
    userPoolWebClientId: config.userPoolClientId,
  },
});

function MainApplication({ signOut, user }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [reservations, setReservations] = useState([]);
  const [view, setView] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  // メッセージが追加されたら自動スクロール
  //useEffect(() => {
    //scrollToBottom();
  //}, [messages]);

  //const scrollToBottom = () => {
    //messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  //};

  // チャットメッセージ送信
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);
    setError(null);

    try {
      // 認証トークンを取得
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();

      const response = await axios.post(config.apiEndpoint, { // APIエンドポイントはCDKで設定した /api を指す
        action: 'reserve_gpu_from_nlp', // FastAPI側で定義するアクション名
        payload: {
          natural_language_request: userMessage,
        }
      }, {
        headers: {
          'Authorization': idToken,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: response.data.response }]);
      } else {
        setError('応答の取得に失敗しました');
      }
    } catch (err) {
      console.error("API Error:", err);
      setError(`エラーが発生しました: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 会話をクリア
  const clearConversation = () => {
    setMessages([]);
  };

  // 予約一覧取得関数
  const fetchReservations = async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();
      const response = await axios.post(config.apiEndpoint, {
        action: 'list'
      }, {
        headers: {
          'Authorization': idToken,
          'Content-Type': 'application/json'
        }
      });
      if (response.data.success) {
        setReservations(response.data.reservations);
      } else {
        setError('予約一覧の取得に失敗しました');
      }
    } catch (err) {
      setError('予約一覧の取得に失敗しました: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // need_confirm予約の承諾/異議あり
  const handleConfirmReject = async (reservationId, decision) => {
    setLoading(true);
    setError(null);
    try {
      const session = await Auth.currentSession();
      const idToken = session.getIdToken().getJwtToken();
      await axios.post(config.apiEndpoint, {
        action: 'confirm_reject',
        reservationId,
        decision, // 'accept' or 'dispute'
      }, {
        headers: {
          'Authorization': idToken,
          'Content-Type': 'application/json'
        }
      });
      // 成功したら予約一覧を再取得
      await fetchReservations();
    } catch (err) {
      setError('操作に失敗しました: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 予約一覧画面表示時に自動取得
  useEffect(() => {
    if (view === 'list') {
      fetchReservations();
    }
  }, [view]);

  return (
    <div className="App">
      <header className="App-header">
        <h1>GPU予約システム</h1>
        <nav className="app-nav">
          <button
            className={view === 'create' ? 'active' : ''}
            onClick={() => setView('create')}
          >
            予約作成
          </button>
          <button
            className={view === 'list' ? 'active' : ''}
            onClick={() => setView('list')}
          >
            予約一覧
          </button>
          {/* 管理者用タブも将来的に追加可能 */}
        </nav>
        <div className="header-buttons">
          {/* 「会話をクリア」は予約リクエストの入力履歴クリアなどに変更可能 */}
          <button className="clear-button" onClick={clearConversation}> {/* clearConversation のロジックも適宜変更 */}
            入力クリア
          </button>
          <button className="logout-button" onClick={signOut}>
            ログアウト ({user.username})
          </button>
        </div>
      </header>

      {/* ビューに応じたメインコンテンツの表示 */}
      <main>
        {view === 'create' && (
          <div className="reservation-create-container">
            <div className="messages-container">
              {messages.length === 0 ? (
                <div className="welcome-message">
                  <h2>GPUサーバーを予約します</h2>
                  <p>例: 「明日の午後2時から4時間、GPU Aを学習で使いたいです」</p>
                </div>
              ) : (
                messages.map((msg, index) => (
                  <div key={index} className={`message ${msg.role}`}>
                    <div className="message-content">
                      {/* content が文字列でない場合のエラーを防ぐため、toString() を追加 */}
                      {String(msg.content).split('\n').map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                  </div>
                ))
              )}
              {loading && (
                <div className="message assistant loading">
                  <div className="typing-indicator"><span></span><span></span><span></span></div>
                </div>
              )}
              {error && <div className="error-message">{error}</div>}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className="input-form">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="予約内容を自然言語で入力..."
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e); // handleSubmit は action: 'reserve_gpu_from_nlp' を送信するように改修
                  }
                }}
              />
              <button type="submit" disabled={loading || !input.trim()}>
                予約リクエスト送信
              </button>
            </form>
          </div>
        )}

        {view === 'list' && (
          <div className="reservation-list-container">
            <h2>あなたの予約一覧</h2>
            {loading && <div>読み込み中...</div>}
            {error && <div className="error-message">{error}</div>}
            {reservations.length === 0 ? (
              <p>現在、予約はありません。</p>
            ) : (
              <ul className="reservations-list">
                {reservations.map(reservation => (
                  <li key={reservation.reservationId || reservation.id} className={`reservation-item status-${reservation.status}`}>
                    <div className="reservation-details">{reservation.details}</div>
                    <div className="reservation-status">ステータス: {reservation.status}</div>
                    {reservation.status === 'need_confirm' && (
                      <div className="confirm-actions">
                        <button
                          onClick={() => handleConfirmReject(reservation.reservationId || reservation.id, 'accept')}
                          disabled={loading}
                        >
                          承諾（キャンセルする）
                        </button>
                        <button
                          onClick={() => handleConfirmReject(reservation.reservationId || reservation.id, 'dispute')}
                          disabled={loading}
                        >
                          異議あり
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>

      {/* {view === 'admin' && (
        <main className="admin-dashboard-container">
          <h2>管理ダッシュボード</h2>
          <p>ここに管理者向けの機能が表示されます。</p>
          {/* 全予約一覧、サーバー設定など }
        </main>
      )} */}
      
      <footer>
         <p>Powered by Amazon Bedrock</p>
      </footer>
    </div>
  );
}

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <MainApplication signOut={signOut} user={user} />
      )}
    </Authenticator>
  );
}

export default App;
