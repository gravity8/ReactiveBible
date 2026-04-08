import React from 'react';
import Header from './components/Header';
import SessionBar from './components/SessionBar';
import TranscriptPanel from './components/TranscriptPanel';
import PreviewPanel from './components/PreviewPanel';
import LiveDisplayPanel from './components/LiveDisplayPanel';
import QueuePanel from './components/QueuePanel';
import SearchScripture from './components/SearchScripture';
import RecentDetections from './components/RecentDetections';
import SettingsModal from './components/SettingsModal';
import PastorProfileModal from './components/PastorProfileModal';
import Toast from './components/Toast';

export default function App() {
  return (
    <div className="app">
      <Header />
      <SessionBar />

      <div className="panels-row">
        <TranscriptPanel />
        <PreviewPanel />
        <LiveDisplayPanel />
        <QueuePanel />
      </div>

      <div className="bottom-row">
        <SearchScripture />
        <RecentDetections />
      </div>

      <SettingsModal />
      <PastorProfileModal />
      <Toast />
    </div>
  );
}
