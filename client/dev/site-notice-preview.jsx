import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/saira-condensed/700.css';
import { SiteNoticeEditorBody } from '../src/pages/SiteNoticeEditor.jsx';
import '../src/styles.css';
import '../src/operations/operations.css';
import '../src/pages/web-publication.css';
// Real editor + real server canonicalizer, synthetic in-memory fixture only.
createRoot(document.getElementById('root')).render(<main className="page wide op-page"><p style={{ color: '#fed602', fontWeight: 700 }}>DEV · Estado sintético en memoria · Sin Auth, DB ni publicaciones</p><h1>Publicación web</h1><SiteNoticeEditorBody origin="http://127.0.0.1:61420" /></main>);
