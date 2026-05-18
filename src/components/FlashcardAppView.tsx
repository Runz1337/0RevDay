import React, { useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../lib/utils';
import { FlashcardPlayer } from './ReviewCards';
import { motion, AnimatePresence } from 'motion/react';

interface FlashcardAppViewProps {
  topic: any;
  onClose: () => void;
  onGenerateSet: (topicId: string, prompt: string, numCards: number) => Promise<void>;
  onDeleteSet: (topicId: string, setId: string) => Promise<void>;
}

export function FlashcardAppView({ topic, onClose, onGenerateSet, onDeleteSet }: FlashcardAppViewProps) {
  const [activeSetId, setActiveSetId] = useState<string | null>(topic.flashcardSets?.[0]?.id || null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [numCards, setNumCards] = useState<number>(30);
  const [isGenerating, setIsGenerating] = useState(false);

  const activeSet = topic.flashcardSets?.find((s: any) => s.id === activeSetId);

  const handleGen = async () => {
    setIsGenerating(true);
    try {
      await onGenerateSet(topic.id, customPrompt, numCards);
      setCustomPrompt('');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex w-full h-full bg-transparent overflow-hidden rounded-[2rem] border border-white/40 shadow-sm relative z-0">
      
      {/* Settings Sidebar Overlay */}
      <AnimatePresence>
        {showSidebar && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 z-[60]"
            onClick={() => setShowSidebar(false)}
          />
        )}
      </AnimatePresence>

      {/* Settings Sidebar Drawer */}
      <AnimatePresence>
        {showSidebar && (
          <motion.div 
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            className="fixed top-0 bottom-0 left-0 w-[85vw] max-w-[320px] glass z-[70] shadow-2xl flex flex-col border-r border-white/20"
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
               <h3 className="font-semibold tracking-tight text-gray-900">Flashcard Sets</h3>
               <button onClick={() => setShowSidebar(false)} className="p-2 rounded-full hover:bg-black/5 transition-colors text-gray-900">
                  <Icons.X size={20} />
               </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-8">
              {/* Set Selection */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3 block">Available Sets</label>
                {topic.flashcardSets?.length > 0 ? (
                  <div className="space-y-2">
                    {topic.flashcardSets.map((s: any, idx: number) => (
                      <div 
                        key={s.id}
                        onClick={() => { setActiveSetId(s.id); setShowSidebar(false); }}
                        className={cn(
                          "p-3 rounded-xl border cursor-pointer transition-colors flex flex-col",
                          activeSetId === s.id ? "bg-black text-white border-black" : "bg-white text-gray-900 border-gray-200 hover:border-gray-300"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                           <span className="font-semibold text-sm truncate pr-2">{topic.title} • {idx === topic.flashcardSets.length - 1 ? 'Base Set' : `Set ${topic.flashcardSets.length - idx}`}</span>
                           <span className={cn("text-[10px] uppercase font-bold tracking-widest shrink-0", activeSetId === s.id ? "text-gray-300" : "text-gray-400")}>{s.cards.length} cards</span>
                        </div>
                        <div className={cn("text-xs flex items-center justify-between", activeSetId === s.id ? "text-gray-300" : "text-gray-500")}>
                           <span>{new Date(s.timestamp).toLocaleDateString()}</span>
                           <button 
                              onClick={async (e) => {
                                e.stopPropagation();
                                await onDeleteSet(topic.id, s.id);
                                if (activeSetId === s.id) {
                                  setActiveSetId(topic.flashcardSets?.find((tSet: any) => tSet.id !== s.id)?.id || null);
                                }
                              }}
                              className="hover:text-red-400 p-1 rounded"
                           >
                             <Icons.Trash2 size={14} />
                           </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No sets generated yet.</p>
                )}
              </div>

              {/* Generate New */}
              <div className="pt-6 border-t border-black/5">
                <h4 className="text-sm font-bold text-gray-900 mb-2 tracking-tight">Generate New Set</h4>
                <p className="text-xs text-gray-600 mb-5 leading-relaxed">Let AI read your notes and extract exhaustive active recall questions.</p>
                
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-2">Target Card Count (Min)</label>
                    <input 
                      type="number" 
                      min="1" max="200"
                      value={numCards}
                      onChange={(e) => setNumCards(parseInt(e.target.value) || 20)}
                      className="w-full px-3 py-2 bg-white/50 border border-white/40 focus:bg-white/80 rounded-lg text-sm focus:ring-1 focus:ring-black outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-2">Custom Instructions</label>
                    <textarea 
                      rows={3}
                      placeholder="e.g. Focus on pharmacology logic..."
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      className="w-full px-3 py-2 bg-white/50 border border-white/40 focus:bg-white/80 rounded-lg text-sm focus:ring-1 focus:ring-black outline-none transition-all resize-none"
                    />
                  </div>
                  <button 
                    disabled={isGenerating}
                    onClick={handleGen}
                    className="w-full btn-liquid text-sm font-semibold px-4 py-3 rounded-[1rem] flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isGenerating ? <Icons.Loader2 size={16} className="animate-spin" /> : <Icons.Sparkles size={16} />} 
                    {isGenerating ? 'Generating...' : 'Generate New Set'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Flashcard Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        <header className="absolute top-2 sm:top-4 left-2 right-2 sm:left-4 sm:right-4 flex items-center gap-2 sm:gap-3 z-10 pointer-events-none">
          <button 
            onClick={onClose}
            className="w-10 h-10 sm:w-12 sm:h-12 glass rounded-full flex items-center justify-center hover:bg-white/60 transition-colors pointer-events-auto shadow-sm"
          >
            <Icons.ArrowLeft size={20} className="text-gray-900" />
          </button>
          
          <div className="flex-1 flex justify-center text-center">
            <div className="glass px-4 sm:px-6 py-1.5 sm:py-2 rounded-full pointer-events-auto">
               <h2 className="text-xs sm:text-sm font-semibold tracking-tight text-gray-900 truncate max-w-[150px] sm:max-w-xs">{topic.title}</h2>
               <p className="text-[9px] sm:text-[10px] text-gray-600 font-medium tracking-widest uppercase">Flashcards</p>
            </div>
          </div>

          <button 
            onClick={() => setShowSidebar(!showSidebar)}
            className="w-10 h-10 sm:w-12 sm:h-12 glass rounded-full flex items-center justify-center hover:bg-white/60 transition-colors pointer-events-auto shadow-sm"
          >
            <Icons.Library size={18} className="text-gray-900" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-2 sm:px-4 py-16 sm:py-20 flex items-center justify-center">
          <div className="w-full max-w-3xl mx-auto">
            {activeSet ? (
              <FlashcardPlayer flashcards={activeSet.cards} isLight={true} />
            ) : (
              <div className="glass border-dashed border-2 border-white/50 rounded-3xl p-12 lg:p-20 flex flex-col items-center justify-center text-center max-w-sm mx-auto">
                <div className="w-20 h-20 bg-white/50 rounded-full flex items-center justify-center mb-6 shadow-inner">
                   <Icons.Layers size={32} className="text-gray-500" />
                </div>
                <p className="text-2xl font-semibold tracking-tight text-gray-900 mb-3">No Deck Selected</p>
                <p className="text-sm text-gray-600 mb-8 font-medium">
                  Open the library to select a deck or generate a new one from your notes.
                </p>
                <button 
                  onClick={() => setShowSidebar(true)}
                  className="btn-liquid px-6 py-3 rounded-full font-semibold flex items-center gap-2 shadow-sm"
                >
                  <Icons.Library size={18} /> Open Library
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
