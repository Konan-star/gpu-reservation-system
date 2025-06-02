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

  return (
    <div className="App">
      <header className="App-header">
        <h1>GPU予約システム</h1>
        <nav className="app-nav">
          {/* setView はビューを切り替えるための関数と仮定 */}
          <button onClick={() => setView('create')}>予約作成</button>
          <button onClick={() => setView('list')}>予約一覧</button>
          {/* userRole が 'admin' の場合のみ表示するなどの制御を追加 */}
          {/* <button onClick={() => setView('admin')}>管理画面</button> */}
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
      {view === 'create' && (
        <main className="reservation-create-container"> {/* CSSクラス名を変更 */}
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
        </main>
      )}

      {view === 'list' && (
        <main className="reservation-list-container">
          <h2>あなたの予約一覧</h2>
          {myReservations.length === 0 ? (
            <p>現在、予約はありません。</p>
          ) : (
            <ul className="reservations-list">
              {myReservations.map(reservation => (
                <li key={reservation.id} className={`reservation-item status-${reservation.status}`}>
                  <div className="reservation-details">{reservation.details}</div>
                  <div className="reservation-status">ステータス: {reservation.status}</div>
                  {/* 予約内容に応じてキャンセルボタンなどを追加 */}
                  {/* <button onClick={() => handleCancelReservation(reservation.id)}>キャンセル</button> */}
                </li>
              ))}
            </ul>
          )}
          {/* 必要に応じて予約取得中のローディング表示やエラー表示 */}
        </main>
      )}

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
        <ChatInterface signOut={signOut} user={user} />
      )}
    </Authenticator>
  );
}

export default App;
