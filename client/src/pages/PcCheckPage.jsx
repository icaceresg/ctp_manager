import {PcCheckPanel} from '../operations/PcCheckPanel.jsx';
import {useApp} from '../context.jsx';
import '../operations/operations.css';
export default function PcCheckPage(){const{me,can}=useApp();return <div className="page wide op-page"><header className="op-heading"><div><div className="op-eyebrow">REVISIÓN DE JUGADORES</div><h1>Revisiones PC</h1><p>Expedientes y evidencias del jugador, con asignación y revisión del staff.</p></div></header><PcCheckPanel me={me} can={can}/></div>;}
