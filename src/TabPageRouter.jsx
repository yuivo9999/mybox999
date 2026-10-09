import React, { useState } from 'react';
import { LiveFeature } from './live/LiveFeature.jsx';
import { FavoritesPage } from './favorites/FavoritesPage.jsx';
import { MyPage } from './me/MyPage.jsx';

export function TabPageRouter(props) {
  const { tab, channels, sources, favorites, onLive, onLiveChannel, onTab, toggleFavorite } = props;
  const [favoriteSection, setFavoriteSection] = useState('movies');
  if (tab === 'live') {
    return <LiveFeature channels={channels} sources={sources} favorites={favorites} onChannel={onLiveChannel} onPlay={onLive} onTab={onTab} toggleFavorite={toggleFavorite} />;
  }
  if (tab === 'favorites') {
    return <FavoritesPage movies={props.movies} channels={channels} favorites={favorites} onMovie={props.onMovie} onLiveChannel={onLiveChannel} favoriteSection={favoriteSection} onFavoriteSectionChange={setFavoriteSection} />;
  }
  return <MyPage {...props} />;
}
