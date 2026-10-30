/** Real Manager component with a synthetic admin prop. API is mocked only by the local QA browser. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/saira-condensed/700.css';
import RankedEventPanel from '../src/pages/RankedEventPanel.jsx';
import '../src/styles.css';
import '../src/operations/operations.css';

if(!import.meta.env.DEV||!['localhost','127.0.0.1','[::1]'].includes(window.location.hostname))throw new Error('Local development fixture only');
createRoot(document.getElementById('root')).render(<main style={{maxWidth:1050,margin:'0 auto',padding:20}}><p style={{fontSize:12,color:'#ddbd79'}}>DEV local · UI fixture con datos sintéticos · sin autenticación real ni conexión a PRE/PROD</p><RankedEventPanel user={{id:1,is_admin:true}}/></main>);
