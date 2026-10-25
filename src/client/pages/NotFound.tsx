import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/hooks';

export default function NotFound() {
  useDocumentTitle('Off the chart');
  return (
    <div className="page notfound">
      <p className="eyebrow mono">Position unknown · 404</p>
      <h1>
        Here be <em>dragons.</em>
      </h1>
      <p className="muted">
        This stretch of water isn’t on our chart. Plot a course back to known waters.
      </p>
      <div className="hero-cta">
        <Link to="/" className="btn btn-primary">
          Return to the surface
        </Link>
        <Link to="/bridge" className="btn">
          Open the bridge
        </Link>
      </div>
    </div>
  );
}
