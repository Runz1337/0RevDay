import React, { useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import { formatDistanceToNow, isPast } from 'date-fns';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import confetti from 'canvas-confetti';

interface TopicUIProps {
  key?: React.Key;
  topic: any;
  onReviewComplete: (topicId: string, confidence: number) => Promise<void> | void;
  onToggleSub?: (topicId: string, subIndex: number) => void;
  onDeleteTopic?: (topicId: string) => void;
  onOpenFlashcards?: (topicId: string) => void;
  onEditTime?: (topicId: string, newTimeUtc: number) => void;
}

export function playReminderSound() {
  try {
    const audio = new Audio('/mixkit-message-pop-alert-2354.mp3');
    audio.play().catch(e => console.error("Audio play failed", e));
  } catch (e) {
    console.log("Audio play failed", e);
  }
}

function LiveTimerIndicator({ topic, onEditTime }: { topic: any, onEditTime?: (id: string, time: number) => void }) {
  const [now, setNow] = useState(Date.now());
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  
  React.useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const nextReviewUtc = topic.nextReviewUtc;
  const isDue = now >= nextReviewUtc;
  const diffSeconds = Math.floor((nextReviewUtc - now) / 1000);
  const secondsLeft = Math.abs(diffSeconds);
  
  const prevSeconds = React.useRef(diffSeconds);
  React.useEffect(() => {
    if (prevSeconds.current > 0 && diffSeconds <= 0) {
      playReminderSound();
    }
    prevSeconds.current = diffSeconds;
  }, [diffSeconds]);

  const h = Math.floor(secondsLeft / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = secondsLeft % 60;
  
  const timeStr = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  
  // Format based on backwards countdown
  const formattedTime = isDue ? `OVERDUE +${timeStr}` : `-${timeStr}`;

  const handleEditCall = (e: React.MouseEvent) => {
     e.stopPropagation();
     if (isEditing && onEditTime && editVal) {
        onEditTime(topic.id, new Date(editVal).getTime());
        setIsEditing(false);
     } else {
        const d = new Date(nextReviewUtc);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        setEditVal(d.toISOString().slice(0,16));
        setIsEditing(true);
     }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2" onClick={e => e.stopPropagation()}>
      <div className={cn("text-[11px] font-bold px-3 py-1.5 rounded-full inline-flex items-center border font-mono tracking-wider shadow-sm transition-colors", 
        isDue ? "border-red-500/50 bg-red-500/10 text-red-600" : "border-gray-200/50 bg-white/40 text-gray-700 backdrop-blur-sm"
      )}>
        <Icons.Timer size={14} className={cn("mr-1.5", isDue && "animate-pulse")} />
        <span className="min-w-[70px] text-center">{formattedTime}</span>
      </div>
      {onEditTime && (
        <div className="flex items-center gap-1">
           {isEditing ? (
             <div className="flex items-center gap-1 bg-white/60 backdrop-blur-md border border-white/80 rounded-full shadow-sm px-2 py-1">
                <input 
                   type="datetime-local" 
                   value={editVal}
                   onChange={e => setEditVal(e.target.value)}
                   className="text-xs px-2 py-1 bg-transparent font-mono outline-none text-gray-800"
                />
                <button 
                  onClick={handleEditCall} 
                  className="bg-black/80 text-white rounded-full p-1.5 hover:bg-black transition-colors"
                >
                  <Icons.Check size={14} />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); setIsEditing(false); }} 
                  className="bg-gray-200/80 text-gray-700 rounded-full p-1.5 hover:bg-gray-300 transition-colors"
                >
                  <Icons.X size={14} />
                </button>
             </div>
           ) : (
             <button 
               onClick={handleEditCall} 
               className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider px-3 py-1.5 bg-white/40 backdrop-blur-sm border border-gray-200/50 text-gray-600 hover:text-black hover:bg-white/60 transition-all rounded-full"
             >
               <Icons.Edit2 size={12} />
               <span>Edit</span>
             </button>
           )}
        </div>
      )}
    </div>
  );
}

function ProjectedSchedule({ topic }: { topic: any }) {
  let stab = Math.max(1, topic.stability || 1);
  let vol = Math.max(1, topic.volatilityScore || 5);
  const bw = topic.bandwidthWeight || 0.5;
  const days = [];
  for(let i=0; i<3; i++) {
     stab += 1.0;
     vol = Math.max(1, vol - 1.0);
     const ms = 1000 * 60 * 60 * 24 * (stab / vol) * bw;
     days.push(Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24))));
  }
  
  return (
    <div className="mt-4 flex items-center gap-1.5 text-[10px] uppercase font-bold text-gray-400 tracking-wider">
      <Icons.TrendingUp size={12} className="text-gray-300" />
      <span className="hidden sm:inline">Proj. Intervals: </span>
      <div className="flex items-center gap-1">
         {days.map((d, i) => (
           <React.Fragment key={i}>
             <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">+{d}d</span>
             {i < days.length - 1 && <span className="text-gray-300">→</span>}
           </React.Fragment>
         ))}
      </div>
    </div>
  )
}

export function FlashcardPlayer({ flashcards }: { flashcards: any[], isLight?: boolean }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const nextCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentIndex < flashcards.length - 1) {
      setFlipped(false);
      setTimeout(() => setCurrentIndex(currentIndex + 1), 150);
    }
  };

  const prevCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentIndex > 0) {
      setFlipped(false);
      setTimeout(() => setCurrentIndex(currentIndex - 1), 150);
    }
  };

  const handleDragEnd = (event: any, info: any) => {
    if (info.offset.x > 50 && currentIndex > 0) {
      prevCard(event);
    } else if (info.offset.x < -50 && currentIndex < flashcards.length - 1) {
      nextCard(event);
    }
  };

  const currentCard = flashcards[currentIndex];
  if (!currentCard) return null;

  return (
    <div className="w-full flex flex-col items-center">
          <motion.div
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            className="w-full"
          >
            <motion.div
              initial={false}
              animate={{ rotateY: flipped ? 180 : 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
              style={{ transformStyle: "preserve-3d" }}
              className={cn(
                "relative w-full min-h-[300px] rounded-[1.5rem] sm:rounded-[2rem] cursor-pointer flex justify-center items-center",
              )}
              onClick={(e) => { e.stopPropagation(); setFlipped(!flipped); }}
            >
              {/* Front */}
            <div 
              style={{ backfaceVisibility: "hidden" }}
              className="absolute inset-0 flex flex-col items-center justify-center p-5 sm:p-8 bg-white/80 backdrop-blur-xl text-gray-900 border border-white/60 rounded-[inherit] shadow-sm text-center"
            >
              <div className="text-[9px] sm:text-[10px] uppercase tracking-widest font-semibold mb-4 sm:mb-6 opacity-50">Question {currentIndex + 1} of {flashcards.length}</div>
              <div className="text-lg sm:text-xl font-medium leading-relaxed max-w-2xl px-2">
                <Markdown remarkPlugins={[remarkGfm]}>{currentCard.question}</Markdown>
              </div>
              <div className="mt-8 sm:mt-10 text-[9px] sm:text-[10px] uppercase tracking-wider flex items-center gap-1.5 opacity-40 font-bold bg-black/5 px-3 py-1.5 rounded-full">
                <Icons.MousePointerClick size={12} /> Tap to Reveal
              </div>
            </div>

            {/* Back */}
            <div 
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
              className="absolute inset-0 flex flex-col items-start p-5 sm:p-8 bg-gray-900 text-white/90 border border-gray-800 rounded-[inherit] shadow-lg text-left"
            >
              <div className="text-[9px] sm:text-[10px] uppercase tracking-widest font-semibold mb-4 opacity-50 text-blue-200">Answer</div>
              <div className="text-base sm:text-lg font-normal leading-relaxed flex-1 w-full prose prose-sm sm:prose-base prose-invert max-w-none prose-p:my-1 overflow-y-auto custom-scrollbar pr-2">
                <Markdown remarkPlugins={[remarkGfm]}>{currentCard.answer}</Markdown>
              </div>
            </div>
          </motion.div>
          </motion.div>

      <div className="flex items-center justify-between w-full mt-6" onClick={e => e.stopPropagation()}>
        <button 
          onClick={prevCard} 
          disabled={currentIndex === 0}
          className={cn("p-3 rounded-full transition-colors flex items-center gap-2", 
            currentIndex === 0 ? "opacity-30 cursor-not-allowed" : "glass hover:bg-white/60",
            "text-gray-900"
          )}
        >
          <Icons.ArrowLeft size={16} />
        </button>
        <div className="flex gap-1.5 flex-wrap justify-center max-w-[60%]">
          {flashcards.map((_, idx) => (
             <div key={idx} className={cn("w-1.5 h-1.5 rounded-full", idx === currentIndex ? "bg-black/80" : "bg-black/10")} />
          ))}
        </div>
        <button 
          onClick={nextCard} 
          disabled={currentIndex === flashcards.length - 1}
          className={cn("p-3 rounded-full transition-colors flex items-center gap-2", 
            currentIndex === flashcards.length - 1 ? "opacity-30 cursor-not-allowed" : "glass hover:bg-white/60",
            "text-gray-900"
          )}
        >
          <Icons.ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

function ExpandedDetails({ topic, onToggleSub, onDeleteTopic, onOpenFlashcards }: { topic: any, isLight?: boolean, onToggleSub?: (topicId: string, idx: number) => void, onDeleteTopic?: (topicId: string) => void, onOpenFlashcards?: (topicId: string) => void }) {
  return (
    <motion.div 
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className={"mt-6 pt-6 border-t border-gray-100"}
    >
      {topic.subTopics && topic.subTopics.length > 0 && (
        <div className="mb-6">
          <ul className="space-y-4 text-left">
            {topic.subTopics.map((sub: any, i: number) => (
              <li 
                key={i} 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  onToggleSub?.(topic.id, i); 
                  if (sub.completed) {
                    confetti({
                      particleCount: 30,
                      spread: 60,
                      origin: { y: 0.8 },
                      colors: ['#007AFF', '#FF2D55', '#34C759', '#FF9500']
                    });
                  }
                }}
                className={cn("flex items-start gap-4 cursor-pointer", 
                  sub.completed ? "opacity-40" : "opacity-100"
                )}
              >
                <div className={cn("mt-0.5 shrink-0 flex items-center justify-center w-5 h-5 rounded border transition-colors", 
                  sub.completed ? "bg-black border-black text-white" : "border-gray-300 text-transparent"
                )}>
                  <Icons.Check size={12} strokeWidth={3} />
                </div>
                <div className="flex flex-col w-full">
                  <span className={cn("font-medium text-sm transition-all text-gray-900", sub.completed && "line-through")}>{sub.title}</span>
                  {sub.details && <div className={cn("text-xs mt-1 text-gray-500 transition-all leading-relaxed max-w-none prose prose-sm prose-slate prose-p:my-1", 
                      sub.completed && "line-through")}>
                    <Markdown remarkPlugins={[remarkGfm]}>{sub.details}</Markdown>
                  </div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {topic.flashcardSets && topic.flashcardSets.length > 0 && (
        <div className="mb-6">
          <div className="text-[10px] flex items-center gap-2 text-gray-400 font-semibold tracking-widest uppercase">
            <Icons.Layers size={14} /> {topic.flashcardSets.length} Flashcard Set(s)
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 mt-4">
         {onOpenFlashcards && (
           <SliderToOpen onOpen={() => onOpenFlashcards(topic.id)} />
         )}
         <div className="flex justify-end gap-3">
           {onDeleteTopic && (
             <button 
               onClick={(e) => { e.stopPropagation(); onDeleteTopic(topic.id); }} 
               className="text-xs font-semibold px-4 py-2 rounded-full border border-red-100 text-red-600 hover:bg-red-50 transition-colors"
             >
               Delete Topic
             </button>
           )}
         </div>
      </div>
    </motion.div>
  );
}

function SliderToOpen({ onOpen }: { onOpen: () => void }) {
  const [complete, setComplete] = useState(false);
  const trackRef = React.useRef<HTMLDivElement>(null);
  
  const x = useMotionValue(0);
  const opacity = useTransform(x, [0, 150], [1, 0]);

  const handleDragEnd = (e: any, info: any) => {
    if (!trackRef.current) return;
    const trackWidth = trackRef.current.offsetWidth;
    if (x.get() > trackWidth - 80) {
       setComplete(true);
       setTimeout(onOpen, 200);
    }
  };

  return (
    <div 
      className="relative w-full h-14 bg-gradient-to-r from-white/40 to-white/10 backdrop-blur-[30px] rounded-[1.5rem] overflow-hidden flex items-center p-1 border border-white/50 shadow-[inset_0_1px_3px_rgba(255,255,255,1),0_2px_12px_rgba(0,0,0,0.06)]" 
      ref={trackRef} 
      onClick={e => e.stopPropagation()}
    >
      <motion.div 
         style={{ opacity }}
         className="absolute w-full text-center pointer-events-none flex items-center justify-center gap-2 select-none"
      >
        <span className="text-gray-500/80 font-bold tracking-widest text-[11px] uppercase drop-shadow-sm shine-effect bg-clip-text text-transparent bg-gradient-to-r from-gray-400 via-gray-800 to-gray-400 bg-[length:200%_auto] animate-shimmer">
          Slide to open flashcards
        </span>
      </motion.div>
      <motion.div
        drag="x"
        dragConstraints={trackRef}
        dragSnapToOrigin={!complete}
        dragElastic={0.4}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 20 }}
        onDragEnd={handleDragEnd}
        style={{ x }}
        className="h-12 w-16 bg-white/90 backdrop-blur-md rounded-[1.2rem] flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.1),inset_0_-2px_4px_rgba(0,0,0,0.05)] border border-white cursor-grab active:cursor-grabbing z-10"
      >
        <Icons.ChevronRight className="text-gray-900" size={20} strokeWidth={3} />
      </motion.div>
    </div>
  )
}

export function FireCard({ topic, onReviewComplete, onToggleSub, onDeleteTopic, onOpenFlashcards, onEditTime }: TopicUIProps) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-6 sm:p-8 rounded-[2rem] relative cursor-pointer group hover:opacity-90 transition-opacity w-full border border-white/20 shadow-lg"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex flex-col relative z-10 w-full">
        <div className="flex items-center justify-between text-gray-400 font-semibold text-[10px] uppercase tracking-widest mb-4 pr-10">
          <div className="flex items-center space-x-2">
            <span className="text-black">{topic.uiPriorityLabel || 'CRITICAL'}</span>
            <span>/</span>
            <span>{topic.category}</span>
          </div>
        </div>
        
        <h3 className="text-xl sm:text-2xl font-medium mb-2 text-gray-900 pr-8 tracking-tight">{topic.title}</h3>
        <p className="text-gray-500 text-xs sm:text-sm mb-4 leading-relaxed font-normal">
          {topic.reminderCopy || topic.description}
        </p>
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <LiveTimerIndicator topic={topic} onEditTime={onEditTime} />
          <ProjectedSchedule topic={topic} />
        </div>

        <div className="absolute top-0 right-0 text-gray-300 group-hover:text-black transition-colors">
            {expanded ? <Icons.Minus size={20} /> : <Icons.Plus size={20} />}
        </div>

        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100/50" onClick={(e) => e.stopPropagation()}>
           {onOpenFlashcards && (
              <button 
                onClick={() => onOpenFlashcards(topic.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white/50 hover:bg-white rounded-full transition-all border border-gray-200/50"
              >
                <Icons.Layers size={14} />
                <span>Practice Cards</span>
              </button>
           )}
        </div>

        <AnimatePresence>
          {expanded && <ExpandedDetails topic={topic} onToggleSub={onToggleSub} onDeleteTopic={onDeleteTopic} onOpenFlashcards={onOpenFlashcards} />}
        </AnimatePresence>
        
        <div className="flex space-x-2 mt-4 pt-4 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={() => onReviewComplete(topic.id, 0.5)}
            className="flex-1 py-3 px-4 rounded-full border border-gray-200 bg-white text-sm font-medium hover:bg-gray-50 transition-colors text-gray-600"
          >
            Hard
          </button>
          <button 
            onClick={() => onReviewComplete(topic.id, 1.0)}
            className="flex-1 py-3 px-4 rounded-full border border-gray-200 bg-white text-sm font-medium hover:bg-gray-50 transition-colors text-gray-600"
          >
            Good
          </button>
          <button 
            onClick={() => onReviewComplete(topic.id, 1.5)}
            className="flex-1 py-3 px-4 rounded-full bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Easy
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export function PulseCard({ topic, onReviewComplete, onToggleSub, onDeleteTopic, onOpenFlashcards, onEditTime }: TopicUIProps) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card p-6 rounded-[2rem] relative cursor-pointer hover:opacity-90 transition-opacity group flex flex-col w-full h-full border border-white/20 shadow-md"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex-1 relative">
        <div className="absolute top-0 right-0 text-gray-300 group-hover:text-black transition-colors">
           {expanded ? <Icons.Minus size={20} /> : <Icons.Plus size={20} />}
        </div>

        <div className="flex items-center gap-2 text-gray-400 font-semibold text-[10px] uppercase tracking-widest mb-3 pr-10">
          <span>{topic.category}</span>
          <span>/</span>
          <span>QUICK RECALL</span>
        </div>
        
        <h4 className="text-lg font-medium text-gray-900 mb-2 pr-8 leading-tight tracking-tight">{topic.title}</h4>
        <p className="text-gray-500 text-xs sm:text-sm mb-4 leading-relaxed line-clamp-2">{topic.reminderCopy || 'Quick active recall.'}</p>
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <LiveTimerIndicator topic={topic} onEditTime={onEditTime} />
          <ProjectedSchedule topic={topic} />
        </div>

        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100/50" onClick={(e) => e.stopPropagation()}>
           {onOpenFlashcards && (
              <button 
                onClick={() => onOpenFlashcards(topic.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white/50 hover:bg-white rounded-full transition-all border border-gray-200/50"
              >
                <Icons.Layers size={14} />
                <span>Practice Cards</span>
              </button>
           )}
        </div>

        <AnimatePresence>
          {expanded && <ExpandedDetails topic={topic} onToggleSub={onToggleSub} onDeleteTopic={onDeleteTopic} onOpenFlashcards={onOpenFlashcards} />}
        </AnimatePresence>
      </div>
      
      <div className="flex space-x-2 mt-4 pt-4 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
         <button 
            onClick={() => onReviewComplete(topic.id, 0.5)}
            className="w-1/2 py-2.5 border border-gray-200 rounded-full text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
         >
            Missed
         </button>
         <button 
            onClick={() => onReviewComplete(topic.id, 1.2)}
            className="w-1/2 py-2.5 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-800 transition-colors"
         >
            Got It
         </button>
      </div>
    </motion.div>
  );
}

export function GhostCard({ topic, onToggleSub, onDeleteTopic, onOpenFlashcards, onEditTime }: { key?: React.Key; topic: any, onToggleSub?: (id: string, idx: number) => void, onDeleteTopic?: (id: string) => void, onOpenFlashcards?: (id: string) => void, onEditTime?: (id: string, time: number) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div 
      className="glass-card p-5 rounded-[1.5rem] relative cursor-pointer transition-colors hover:opacity-90 group flex flex-col w-full h-full border border-white/20 shadow-sm"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between w-full">
        <div className="flex-1 min-w-0 pr-4">
          <h5 className="text-sm font-medium text-gray-900 truncate mb-1">{topic.title}</h5>
          <p className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold">{topic.category}</p>
        </div>
        <div className="shrink-0 text-gray-300 group-hover:text-black">
           {expanded ? <Icons.Minus size={16} /> : <Icons.Plus size={16} />}
        </div>
      </div>
      
      <div className="mt-2">
         <LiveTimerIndicator topic={topic} onEditTime={onEditTime} />
      </div>

      <AnimatePresence>
        {expanded && (
           <motion.div 
             initial={{ height: 0, opacity: 0 }}
             animate={{ height: 'auto', opacity: 1 }}
             exit={{ height: 0, opacity: 0 }}
             className="overflow-hidden"
           >
             <div className="pt-2" onClick={e => e.stopPropagation()}>
               <ExpandedDetails topic={topic} onToggleSub={onToggleSub} onDeleteTopic={onDeleteTopic} onOpenFlashcards={onOpenFlashcards} />
             </div>
           </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
