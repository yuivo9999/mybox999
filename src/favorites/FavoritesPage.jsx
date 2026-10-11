import { ChevronLeft, Database, Radio, Film } from 'lucide-react';
import { MovieCarousel } from '../shared__components__media__MovieCarousel.jsx';

function FavoriteEmptyState({ text }) {
  return <div className="empty"><Film size={22} /><span>{text}</span></div>;
}

export function FavoritesPage({ movies = [], channels = [], favorites = [], onMovie, onLiveChannel, favoriteSection = 'movies', onFavoriteSectionChange = () => {} }) {
  const favoriteContentRecords = favorites.filter(item => item.targetType === 'content');
  const favMovies = favoriteContentRecords.map(record => movies.find(movie => movie.contentId === record.targetId) || ({
    contentId: record.targetId, title: '暂时无法找到来源', year: '', category: '', poster: '', unresolved: true,
  }));
  const favChannels = channels.filter(channel => favorites.some(item => item.targetType === 'channel' && item.targetId === channel.channelId));
  return <Page>
    <Header title="收藏" />
    <div className="seg">
      <button className={favoriteSection === 'movies' ? 'active' : ''} onClick={() => onFavoriteSectionChange('movies')}>影视</button>
      <button className={favoriteSection === 'live' ? 'active' : ''} onClick={() => onFavoriteSectionChange('live')}>Live</button>
    </div>
    {favoriteSection === 'movies' ? <>
      <MovieCarousel movies={favMovies.filter(movie => !movie.unresolved)} onMovie={onMovie} ariaLabel="收藏影视" />
      {favMovies.filter(movie => movie.unresolved).map(movie => <div className="info-card" key={movie.contentId}>
        <Database size={18} /><div><b>暂时无法找到来源</b><span>收藏仍已保留：{movie.contentId}</span></div>
      </div>)}
      {!favMovies.length && <FavoriteEmptyState text="还没有影视收藏" />}
    </> : <div className="channel-list">
      {favChannels.map(channel => <button className="menu" key={channel.channelId} onClick={() => onLiveChannel(channel)}>
        <Radio size={18} /><span>{channel.name}<small>{channel.category} · {channel.streams.length} 条线路</small></span><ChevronLeft className="flip" size={17} />
      </button>)}
      {!favChannels.length && <FavoriteEmptyState text="还没有 Live 收藏" />}
    </div>}
  </Page>;
}

const Page = ({ children }) => <main className="page">{children}</main>;
const Header = ({ title }) => <header><div><span className="eyebrow">TVBOX REACT</span><h2>{title}</h2></div></header>;
