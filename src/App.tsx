import React, { useState, useEffect } from 'react';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, onSnapshot, addDoc, updateDoc, deleteDoc, query, orderBy, where } from 'firebase/firestore';
import { FireCard, PulseCard, GhostCard, playReminderSound } from './components/ReviewCards';
import { scheduleNotification, cancelScheduledNotification, requestNotificationPermission } from './lib/notificationService';
import { FlashcardAppView } from './components/FlashcardAppView';
import { CameraViewfinder } from './components/CameraViewfinder';
import { CalendarWidget } from './components/CalendarWidget';
import { cn } from './lib/utils';
import * as Icons from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'add' | 'cards' | 'settings'>('dashboard');
  
  // Data State
  const [topics, setTopics] = useState<any[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);
  
  // Form State
  const [dailyLog, setDailyLog] = useState('');
  const [syllabusContext, setSyllabusContext] = useState('');
  const [difficulty, setDifficulty] = useState('Medium');
  const [timeTaken, setTimeTaken] = useState('');
  const [base64Images, setBase64Images] = useState<{data: string, mimeType: string}[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedTopicIdForFlashcards, setSelectedTopicIdForFlashcards] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      
      if (u) {
        // Fetch or create profile
        try {
          const profileRef = doc(db, 'users', u.uid);
          const profileSnap = await getDoc(profileRef);
          if (!profileSnap.exists()) {
            const newProfile = {
              dailyCognitiveBandwidth: 50,
              createdAt: Date.now()
            };
            await setDoc(profileRef, newProfile);
            setUserProfile(newProfile);
          } else {
            setUserProfile(profileSnap.data());
          }
          
          // Listen to topics
          const topicsRef = collection(db, 'users', u.uid, 'topics');
          const q = query(topicsRef, where("userId", "==", u.uid), orderBy('nextReviewUtc', 'asc'));
          
          const unsubTopics = onSnapshot(q, (snap) => {
            setTopics(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          }, (error) => {
            handleFirestoreError(error, OperationType.GET, `users/${u.uid}/topics`);
          });
          
          setLoading(false);
          return () => unsubTopics();
        } catch (error) {
           handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
           setLoading(false);
        }
      } else {
        setTopics([]);
        setUserProfile(null);
        setLoading(false);
      }
    });
    
    return unsubscribe;
  }, []);

  useEffect(() => {
    // Schedule notifications for all topics
    topics.forEach(t => {
      if (!t.isCompleted) {
        scheduleNotification(
          t.id, 
          "Review Reminder: " + t.title, 
          t.nextReviewUtc, 
          t.reminderCopy || "It's time to review this topic!"
        );
      } else {
        cancelScheduledNotification(t.id);
      }
    });
    
    // Cleanup on unmount or when topics change (this might be overkill to clear them all on every re-render, 
    // but the service function handles clearing by ID inside it, so it's safe to just call schedule again)
  }, [topics]);

  const login = () => {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider);
  };

  const logout = () => signOut(auth);

  const processLog = async () => {
    if (!dailyLog && base64Images.length === 0) return;
    if (!user) return;
    setIsProcessing(true);
    setErrorMsg('');
    
    try {
      const customAiModel = localStorage.getItem('customAiModel') || '';
      const customAiUrl = localStorage.getItem('customAiUrl') || '';
      const customAiKey = localStorage.getItem('customAiKey') || '';
      const res = await fetch('/api/analyze-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          dailyInput: dailyLog, 
          syllabusContext, 
          difficulty, 
          timeTaken, 
          base64Images,
          customAiModel,
          customAiUrl,
          customAiKey
        })
      });
      
      if (!res.ok) throw new Error(await res.text());
      const { topics: newTopics } = await res.json();
      
      // Save each to Firestore
      for (const t of newTopics) {
        const now = Date.now();
        // Base DLBS Calculation from AI
        const offsetHours = t.schedule?.next_review_utc_offset_hours || 24;
        const nextReviewMs = now + (1000 * 60 * 60 * offsetHours);
        const bandwidthWeight = t.schedule?.bandwidth_weight || (t.metadata.hardness / 10);
        
        let initialFlashcardSets = [];
        if (t.flashcards && Array.isArray(t.flashcards) && t.flashcards.length > 0) {
          initialFlashcardSets.push({
            id: Date.now().toString() + Math.random().toString(36).substring(7),
            timestamp: now,
            userPrompt: "Initial detailed generation from notes",
            cards: t.flashcards
          });
        }

        const payload = {
          userId: user.uid,
          title: t.title,
          description: t.description || '',
          detailedNotes: t.detailedNotes || '',
          subTopics: t.sub_topics || [],
          flashcardSets: initialFlashcardSets,
          hardness: t.metadata.hardness,
          yield: t.metadata.yield,
          category: t.metadata.category,
          visualDensityScore: t.metadata.visual_density_score || null,
          nextReviewUtc: nextReviewMs,
          bandwidthWeight: bandwidthWeight,
          volatilityScore: Math.max(t.metadata.hardness, t.metadata.visual_density_score || 0), // Base volatility on hardness and visual density
          stability: 0,
          isCompleted: false,
          reminderCopy: t.reminder_copy || '',
          uiCardColor: t.ui_elements?.card_color || '#333333',
          uiIcon: t.ui_elements?.icon || 'BookOpen',
          uiPriorityLabel: t.ui_elements?.priority_label || 'NORMAL',
          createdAt: now,
          updatedAt: now
        };
        
        await addDoc(collection(db, 'users', user.uid, 'topics'), payload);
      }
      
      setDailyLog('');
      setDifficulty('Medium');
      setTimeTaken('');
      setBase64Images([]);
      setActiveTab('dashboard');
    } catch (error: any) {
      console.error(error);
      setErrorMsg(error.message || 'Error processing notes. Check console.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      Array.from(e.target.files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1024;
            const MAX_HEIGHT = 1024;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
              }
            } else {
              if (height > MAX_HEIGHT) {
                width *= MAX_HEIGHT / height;
                height = MAX_HEIGHT;
              }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            
            // Compress with lower quality to reduce base64 size drastically
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            const base64String = dataUrl.split(',')[1];
            setBase64Images(prev => [...prev, { data: base64String, mimeType: 'image/jpeg' }]);
          };
          img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleReviewComplete = async (topicId: string, confidence: number) => {
    if (!user) return;
    const topic = topics.find(t => t.id === topicId);
    if (!topic) return;

    try {
      const newStep = (topic.reviewStep || 0) + 1;
      const sequence = [2, 3, 5, 7, 21];
      const isFinishing21DaysOrLater = newStep > sequence.length;

      const seqIndex = Math.min(newStep - 1, sequence.length - 1);
      const intervalDays = sequence[seqIndex];

      let nextReviewUtc = topic.nextReviewUtc;
      
      if (!isFinishing21DaysOrLater && !topic.isCompleted) {
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + intervalDays);
        nextDate.setHours(23, 59, 59, 999);
        nextReviewUtc = nextDate.getTime();
      }
      
      const isOptional = sequence[seqIndex] === 7 || sequence[seqIndex] === 21;

      const now = new Date();
      let status = 'on-time';
      let scheduledForNum = topic.nextReviewUtc;

      if (topic.isCompleted) {
         scheduledForNum = now.getTime();
         status = 'on-time';
      } else {
         const scheduledForDate = new Date(topic.nextReviewUtc);
         if (now.getDate() < scheduledForDate.getDate() || now.getMonth() < scheduledForDate.getMonth()) {
             status = 'early';
         } else if (now.getTime() > scheduledForDate.getTime()) {
             status = 'late';
         }
      }

      const historyLog = {
          date: now.getTime(),
          scheduledFor: scheduledForNum,
          status,
          step: newStep
      };

      const updatedHistory = [...(topic.reviewHistory || []), historyLog];

      await updateDoc(doc(db, 'users', user.uid, 'topics', topicId), {
        reviewStep: newStep,
        isCompleted: topic.isCompleted || isFinishing21DaysOrLater,
        isOptional: isOptional,
        reviewHistory: updatedHistory,
        nextReviewUtc: Math.floor(nextReviewUtc),
        updatedAt: Date.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/topics/${topicId}`);
    }
  };

  const handleEditTime = async (topicId: string, newTimeUtc: number) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'topics', topicId), {
        nextReviewUtc: newTimeUtc,
        updatedAt: Date.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/topics/${topicId}`);
    }
  };

  const handleToggleSub = async (topicId: string, subIndex: number) => {
    if (!user) return;
    const topic = topics.find(t => t.id === topicId);
    if (!topic || !topic.subTopics) return;

    const updatedSubTopics = [...topic.subTopics];
    updatedSubTopics[subIndex].completed = !updatedSubTopics[subIndex].completed;

    try {
      await updateDoc(doc(db, 'users', user.uid, 'topics', topicId), {
        subTopics: updatedSubTopics,
        updatedAt: Date.now()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/topics/${topicId}`);
    }
  };

  const handleDeleteTopic = async (topicId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'topics', topicId));
    } catch(err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/topics/${topicId}`);
    }
  };

  const handleGenerateFlashcardSet = async (topicId: string, customPrompt: string, numFlashcards: number) => {
    if (!user) return;
    const topic = topics.find(t => t.id === topicId);
    if (!topic) return;

    try {
      const customAiModel = localStorage.getItem('customAiModel') || '';
      const customAiUrl = localStorage.getItem('customAiUrl') || '';
      const customAiKey = localStorage.getItem('customAiKey') || '';
      const res = await fetch('/api/generate-flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicTitle: topic.title,
          topicDescription: topic.description,
          detailedNotes: topic.detailedNotes,
          subTopics: topic.subTopics,
          userPrompt: customPrompt,
          numFlashcards: numFlashcards,
          customAiModel,
          customAiUrl,
          customAiKey
        })
      });

      if (!res.ok) throw new Error(await res.text());
      const { flashcards } = await res.json();

      const newSet = {
        id: Date.now().toString() + Math.random().toString(36).substring(7),
        timestamp: Date.now(),
        userPrompt: customPrompt || "Default automated generation",
        cards: flashcards
      };

      const currentSets = topic.flashcardSets || [];

      await updateDoc(doc(db, 'users', user.uid, 'topics', topicId), {
        flashcardSets: [newSet, ...currentSets],
        updatedAt: Date.now()
      });
    } catch(err) {
      console.error(err);
      alert("Failed to generate flashcards. Please try again.");
    }
  };

  const handleDeleteFlashcardSet = async (topicId: string, setId: string) => {
    if (!user) return;
    const topic = topics.find(t => t.id === topicId);
    if (!topic) return;

    const currentSets = topic.flashcardSets || [];
    const newSets = currentSets.filter((s: any) => s.id !== setId);

    try {
      await updateDoc(doc(db, 'users', user.uid, 'topics', topicId), {
        flashcardSets: newSets,
        updatedAt: Date.now()
      });
    } catch (err) {
      console.error(err);
    }
  };

  const clearAllNotes = async () => {
    if (!user || topics.length === 0) return;
    // Removed window.confirm because it might block in iframes
    try {
      for (const t of topics) {
        await deleteDoc(doc(db, 'users', user.uid, 'topics', t.id));
      }
    } catch(err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/topics`);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center relative z-10"><Icons.Loader2 className="animate-spin text-gray-400" /></div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-white flex flex-col relative overflow-hidden font-sans text-black selection:bg-black selection:text-white">
        <div className="absolute top-0 left-0 w-full h-[50vh] bg-gradient-to-b from-gray-50 to-white pointer-events-none" />
        <div className="absolute -top-[20vh] -right-[10vh] w-[60vh] h-[60vh] rounded-full bg-gray-50 blur-3xl pointer-events-none" />
        
        <div className="flex-1 flex flex-col items-center justify-center p-6 relative z-10 w-full">
          <div className="w-full max-w-sm">
            <div className="mb-12 flex justify-center">
              <div className="w-24 h-24 bg-white/50 backdrop-blur rounded-[2rem] shadow-xl transform hover:scale-105 transition-transform duration-500 ease-out border border-gray-100 flex items-center justify-center overflow-hidden">
                <img src="/IMG_20260516_153733.png" alt="App Icon" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling!.classList.remove('hidden'); }} />
                <div className="hidden text-gray-400 text-xs text-center p-2">Upload 'IMG_20260516_153733.png' to public</div>
              </div>
            </div>
            
            <div className="text-center space-y-3 mb-16">
              <h1 className="text-4xl font-black tracking-tighter leading-none">0RevDay</h1>
              <p className="text-gray-500 font-medium tracking-tight">Revise. Retain. Excel.</p>
            </div>
            
            <button 
               onClick={login}
               className="group w-full py-4 px-6 rounded-2xl bg-black text-white hover:bg-gray-900 transition-all duration-300 flex items-center justify-center space-x-3 active:scale-[0.98] shadow-xl hover:shadow-black/20"
            >
               <span className="font-semibold text-base tracking-wide">Continue with Google</span>
               <Icons.ArrowRight size={18} className="opacity-0 -ml-6 group-hover:opacity-100 group-hover:ml-0 transition-all duration-300 ease-out" />
            </button>
            <p className="mt-8 text-center text-xs font-medium text-gray-400 tracking-wide">Secure and fast login</p>
          </div>
        </div>
      </div>
    );
  }

  const nowMs = Date.now();
  // Very simplistic sort for UI:
  const activeTopics = topics.filter(t => !t.isCompleted);
  const completedTopics = topics.filter(t => t.isCompleted);
  
  const dueTopics = activeTopics.filter(t => t.nextReviewUtc <= nowMs + (1000 * 60 * 60 * 2)); // due now or within 2 hours
  const upcomingTopics = activeTopics.filter(t => t.nextReviewUtc > nowMs + (1000 * 60 * 60 * 2));

  // Partition due topics by type
  const fireTopics = dueTopics.filter(t => t.hardness >= 7 || t.volatilityScore > 5);
  const pulseTopics = dueTopics.filter(t => t.hardness < 7 && t.volatilityScore <= 5);

  return (
    <div className="min-h-screen font-sans text-gray-900 relative z-10 flex flex-col h-[100dvh] overflow-hidden bg-[#e0e5ec]">
      {!selectedTopicIdForFlashcards && (
        <header className="absolute top-0 left-0 right-0 z-50 pt-[calc(1rem+env(safe-area-inset-top))] px-6 flex items-center justify-between pointer-events-none">
          <div className="flex items-center space-x-2 font-bold text-xl tracking-tight text-gray-800 drop-shadow-sm pointer-events-auto">
           <div className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center shadow-lg overflow-hidden">
                <img src="/IMG_20260516_153733.png" alt="Logo" className="w-full h-full object-cover" />
             </div>
             <span>0RevDay</span>
          </div>
          <div className="flex items-center pointer-events-auto">
             <div className="h-8 w-8 rounded-full bg-white/50 border border-white flex items-center justify-center text-xs font-semibold uppercase shadow-[inset_1px_1px_2px_#ffffff,inset_-1px_-1px_2px_#beccd9]">{user?.email?.charAt(0) || 'U'}</div>
          </div>
        </header>
      )}
      {/* Main nav */}
      <div className="fixed bottom-0 left-0 right-0 z-[110] flex items-end justify-center pb-[calc(10px+env(safe-area-inset-bottom))] px-4 pointer-events-none">
         <nav className="menu transition-all duration-300 relative z-20 translate-y-0 opacity-100 scale-100 pointer-events-auto shadow-2xl">
            <button 
               onClick={() => { setActiveTab('dashboard'); setSelectedTopicIdForFlashcards(null); }} 
               className={activeTab === 'dashboard' && !selectedTopicIdForFlashcards ? 'active' : ''}
            >
               <Icons.LayoutDashboard />
               <span>Dashboard</span>
            </button>
            <button 
               onClick={() => { setActiveTab('add'); setSelectedTopicIdForFlashcards(null); }} 
               className={activeTab === 'add' && !selectedTopicIdForFlashcards ? 'active' : ''}
            >
               <Icons.PlusCircle />
               <span>Add Log</span>
            </button>
            <button 
               onClick={() => { setActiveTab('cards'); setSelectedTopicIdForFlashcards(null); }} 
               className={activeTab === 'cards' && !selectedTopicIdForFlashcards ? 'active' : ''}
            >
               <Icons.Layers />
               <span>Cards</span>
            </button>
            <button 
               onClick={() => { setActiveTab('settings'); setSelectedTopicIdForFlashcards(null); }} 
               className={activeTab === 'settings' && !selectedTopicIdForFlashcards ? 'active' : ''}
            >
               <Icons.Settings />
               <span>Settings</span>
            </button>
         </nav>
      </div>

      <main className={cn("max-w-4xl mx-auto px-4 sm:px-6 w-full flex-1 overflow-y-auto no-scrollbar", selectedTopicIdForFlashcards ? "pt-4 sm:pt-[env(safe-area-inset-top)] pb-8 flex items-center justify-center" : "pt-24 sm:pt-28 pb-32")}>
        <AnimatePresence mode="wait">
          {selectedTopicIdForFlashcards ? (
             <motion.div 
               key="flashcards"
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -10 }}
               className="h-full w-full"
             >
                <FlashcardAppView 
                  topic={topics.find((t: any) => t.id === selectedTopicIdForFlashcards)} 
                  onClose={() => setSelectedTopicIdForFlashcards(null)} 
                  onGenerateSet={handleGenerateFlashcardSet} 
                  onDeleteSet={handleDeleteFlashcardSet} 
                />
             </motion.div>
          ) : activeTab === 'dashboard' ? (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-12"
            >
               <div className="pt-2 sm:pt-4">
                  <CalendarWidget topics={topics} onReviewComplete={handleReviewComplete} />
                  
                  <h2 className="text-lg sm:text-xl font-semibold tracking-tight mb-4 sm:mb-6 flex items-center space-x-2">
                    <div className="w-2 h-2 rounded-full bg-black"></div>
                    <span>Priority Review</span>
                  </h2>
                  {fireTopics.length === 0 ? (
                    <div className="p-6 sm:p-8 rounded-3xl glass-card text-center text-gray-500 font-medium text-sm">
                      Queue clear.
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:gap-6">
                      {fireTopics.map(t => <FireCard key={t.id} topic={t} onReviewComplete={handleReviewComplete} onToggleSub={handleToggleSub} onDeleteTopic={handleDeleteTopic} onOpenFlashcards={setSelectedTopicIdForFlashcards} onEditTime={handleEditTime} />)}
                    </div>
                  )}
               </div>

               <div>
                  <h2 className="text-lg sm:text-xl font-semibold tracking-tight mb-4 sm:mb-6 flex items-center space-x-2">
                    <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                    <span>Active Recall</span>
                  </h2>
                  {pulseTopics.length === 0 ? (
                     <p className="text-gray-400 text-sm pl-4">No active recall sessions due.</p>
                  ) : (
                    <div className="grid gap-4">
                      {pulseTopics.map(t => <PulseCard key={t.id} topic={t} onReviewComplete={handleReviewComplete} onToggleSub={handleToggleSub} onDeleteTopic={handleDeleteTopic} onOpenFlashcards={setSelectedTopicIdForFlashcards} onEditTime={handleEditTime} />)}
                    </div>
                  )}
               </div>

               <div>
                 <div className="flex items-center justify-between mb-4 border-b border-gray-200 pb-2">
                   <h3 className="text-[10px] font-bold text-gray-400 tracking-widest uppercase flex items-center space-x-2">
                     <Icons.Archive size={14} />
                     <span>Upcoming</span>
                   </h3>
                   <button 
                     onClick={clearAllNotes}
                     className="text-[10px] uppercase font-bold text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
                   >
                     <Icons.Trash2 size={12} /> Clear All
                   </button>
                 </div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {upcomingTopics.slice(0,6).map(t => <GhostCard key={t.id} topic={t} onToggleSub={handleToggleSub} onDeleteTopic={handleDeleteTopic} onOpenFlashcards={setSelectedTopicIdForFlashcards} onEditTime={handleEditTime} onReviewComplete={handleReviewComplete} />)}
                 </div>
               </div>

               {completedTopics.length > 0 && (
                 <div className="mt-8 border-t border-gray-200 pt-8">
                   <div className="flex items-center justify-between mb-4 pb-2">
                     <h3 className="text-[10px] font-bold text-gray-400 tracking-widest uppercase flex items-center space-x-2">
                       <Icons.CheckCircle2 size={14} />
                       <span>Completed Mastered</span>
                     </h3>
                   </div>
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {completedTopics.slice(0, 10).map(t => <GhostCard key={t.id} topic={t} onToggleSub={handleToggleSub} onDeleteTopic={handleDeleteTopic} onOpenFlashcards={setSelectedTopicIdForFlashcards} onEditTime={handleEditTime} onReviewComplete={handleReviewComplete} />)}
                   </div>
                 </div>
               )}
            </motion.div>
          ) : activeTab === 'cards' ? (
             <motion.div 
               key="cards"
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -10 }}
               className="w-full max-w-2xl mx-auto space-y-6 pt-4"
             >
                <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-6 flex items-center space-x-2">
                   <Icons.Layers size={24} />
                   <span>Flashcard Hub</span>
                </h2>
                
                {topics.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 glass-card rounded-2xl">
                    No topics created yet.
                  </div>
                ) : (
                  <div className="space-y-4">
                     {topics.map(t => {
                        const setQty = t.flashcardSets?.length || 0;
                        const hasSets = setQty > 0;
                        return (
                           <div key={t.id} className="p-5 bg-white/70 rounded-2xl border border-white/50 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                              <div className="flex-1">
                                <h3 className="font-semibold text-gray-900 text-lg mb-1">{t.title}</h3>
                                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-500">
                                  {hasSets ? (
                                    <span className="bg-blue-50 text-blue-600 px-2.5 py-1 rounded-md border border-blue-100 flex items-center gap-1">
                                      <Icons.Library size={14} />
                                      {setQty} Deck{setQty !== 1 ? 's' : ''}
                                    </span>
                                  ) : (
                                    <span className="bg-gray-100 px-2.5 py-1 rounded-md flex items-center gap-1 border border-gray-200">
                                      <Icons.AlertCircle size={14} />
                                      No Decks
                                    </span>
                                  )}
                                  <span className={cn(
                                    "px-2.5 py-1 rounded-md border", 
                                    t.nextReviewUtc < Date.now() ? "bg-red-50 text-red-600 border-red-100" : "bg-green-50 text-green-600 border-green-100"
                                  )}>
                                    {t.nextReviewUtc < Date.now() ? "Review Pending" : "Current"}
                                  </span>
                                </div>
                              </div>
                              <button
                                onClick={() => setSelectedTopicIdForFlashcards(t.id)}
                                className="px-5 py-2.5 bg-black hover:bg-gray-900 text-white text-sm font-semibold rounded-xl flex items-center space-x-2 w-full sm:w-auto justify-center transition-all active:scale-95 shadow-md"
                              >
                                {hasSets ? (
                                  <>
                                    <span>Study Cards</span>
                                    <Icons.ArrowRight size={16} />
                                  </>
                                ) : (
                                  <>
                                    <Icons.Sparkles size={16} />
                                    <span>Generate</span>
                                  </>
                                )}
                              </button>
                           </div>
                        );
                     })}
                  </div>
                )}
             </motion.div>
          ) : activeTab === 'settings' ? (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-2xl mx-auto sm:pt-4 w-full"
            >
               <div className="bg-white p-6 sm:rounded-3xl px-4 py-8 sm:p-10 -mx-4 sm:mx-0 shadow-sm border border-black/5">
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-6 text-gray-900 border-b border-black/5 pb-4">Settings</h2>
                  
                  <div className="space-y-4">
                     <div className="flex items-center justify-between p-4 bg-white/40 rounded-xl border border-white/60 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]">
                        <div>
                           <p className="font-semibold text-gray-900 text-sm">Reminder Sound</p>
                           <p className="text-xs text-gray-600">Audio tone when due</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                             onClick={() => {
                                playReminderSound();
                             }}
                             className="text-xs font-medium text-gray-600 bg-white px-3 py-1.5 rounded-lg border border-gray-200 hover:text-black transition-colors"
                          >
                             Play Sound
                          </button>

                        </div>
                     </div>
                     
                     <div className="flex items-center justify-between p-4 bg-white/40 rounded-xl border border-white/60 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]">
                        <div>
                           <p className="font-semibold text-gray-900 text-sm">Strict Mode</p>
                           <p className="text-xs text-gray-600">Harder deductions for misses</p>
                        </div>
                        <input type="checkbox" className="liquid-toggle" defaultChecked />
                     </div>
                     
                     <div className="flex items-center justify-between p-4 bg-white/40 rounded-xl border border-white/60 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]">
                        <div>
                           <p className="font-semibold text-gray-900 text-sm">AI Sync Animation</p>
                           <p className="text-xs text-gray-600">Toggle bouncy effects</p>
                        </div>
                        <input type="checkbox" className="liquid-toggle" defaultChecked />
                     </div>

                     <div className="flex items-center justify-between p-4 bg-white/40 rounded-xl border border-white/60 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]">
                        <div>
                           <p className="font-semibold text-gray-900 text-sm">Notifications</p>
                           <p className="text-xs text-gray-600">Enable study reminders</p>
                        </div>
                        <button 
                           onClick={async () => {
                             const allowed = await requestNotificationPermission();
                             if (allowed) {
                               alert('Notifications enabled!');
                             } else {
                               alert('Notifications are not permitted or supported in this browser context.');
                             }
                           }}
                           className="text-xs px-3 py-1.5 bg-black/5 hover:bg-black/10 rounded-lg font-semibold"
                        >
                           Enable
                        </button>
                     </div>

                     <div className="p-4 bg-white/40 rounded-xl border border-white/60 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)] space-y-4">
                        <div>
                           <p className="font-semibold text-gray-900 text-sm">Custom AI Provider</p>
                           <p className="text-xs text-gray-600 mb-4">Use a Gemini-compatible API</p>
                        </div>
                        <div>
                           <label className="block text-xs font-semibold text-gray-500 mb-1">API Key (Optional)</label>
                           <input type="password" 
                              className="w-full px-3 py-2 rounded-lg bg-white/60 border border-white/80 focus:outline-none focus:ring-1 focus:ring-black/20 text-sm" 
                              defaultValue={localStorage.getItem('customAiKey') || ''}
                              onChange={(e) => localStorage.setItem('customAiKey', e.target.value)}
                           />
                        </div>
                        <div>
                           <label className="block text-xs font-semibold text-gray-500 mb-1">Base URL (For compatible proxies)</label>
                           <input type="text" 
                              placeholder="e.g. https://openrouter.ai/api/v1"
                              className="w-full px-3 py-2 rounded-lg bg-white/60 border border-white/80 focus:outline-none focus:ring-1 focus:ring-black/20 text-sm" 
                              defaultValue={localStorage.getItem('customAiUrl') || 'https://generativelanguage.googleapis.com/v1beta'}
                              onChange={(e) => localStorage.setItem('customAiUrl', e.target.value)}
                           />
                        </div>
                        <div>
                           <label className="block text-xs font-semibold text-gray-500 mb-1">Model Name</label>
                           <input type="text" 
                              placeholder="gemini-2.5-flash"
                              className="w-full px-3 py-2 rounded-lg bg-white/60 border border-white/80 focus:outline-none focus:ring-1 focus:ring-black/20 text-sm" 
                              defaultValue={localStorage.getItem('customAiModel') || 'gemini-2.5-flash'}
                              onChange={(e) => localStorage.setItem('customAiModel', e.target.value)}
                           />
                        </div>
                     </div>

                     <div className="pt-6 mt-6 border-t border-black/5">
                        <button onClick={logout} className="w-full flex items-center justify-center space-x-2 p-3 rounded-xl bg-red-50 text-red-600 font-semibold hover:bg-red-100 transition-colors border border-red-100">
                           <Icons.LogOut size={16} />
                           <span>Log Out</span>
                        </button>
                     </div>
                  </div>
               </div>
            </motion.div>
          ) : (
            <motion.div 
              key="add"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-2xl mx-auto sm:pt-4 w-full"
            >
               <div className="bg-white/90 p-8 sm:p-10 -mx-4 sm:mx-0 rounded-[2.5rem] shadow-sm border border-black/5">
                 <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2 text-gray-900">Add Log</h2>
                 <p className="text-gray-500 text-sm mb-8 leading-relaxed font-normal">
                   Record your study session details to update your spacing algorithm.
                 </p>
                 
                 <div className="space-y-6">
                   <div>
                     <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Subject / Context</label>
                     <input 
                       type="text" 
                       value={syllabusContext}
                       placeholder="e.g. Anatomy - Upper Limb"
                       onChange={(e) => setSyllabusContext(e.target.value)}
                       className="w-full px-4 py-3 bg-black/5 hover:bg-black/10 focus:bg-white focus:outline-none focus:ring-2 focus:ring-black/20 rounded-2xl transition-all text-sm font-medium"
                     />
                   </div>
                   
                   <div className="flex flex-col sm:flex-row gap-4">
                     <div className="flex-1">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Time Taken</label>
                        <input 
                          type="text"
                          value={timeTaken}
                          onChange={(e) => setTimeTaken(e.target.value)}
                          placeholder="e.g. 45 mins"
                          className="w-full px-4 py-3 bg-black/5 hover:bg-black/10 focus:bg-white focus:outline-none focus:ring-2 focus:ring-black/20 rounded-2xl transition-all text-sm font-medium"
                        />
                     </div>
                     <div className="flex-1">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Self-Rated Difficulty</label>
                        <select 
                          value={difficulty}
                          onChange={(e) => setDifficulty(e.target.value)}
                          className="w-full px-4 py-3 bg-black/5 hover:bg-black/10 focus:bg-white focus:outline-none focus:ring-2 focus:ring-black/20 rounded-2xl transition-all appearance-none text-sm font-medium"
                        >
                          <option value="Easy">Easy</option>
                          <option value="Medium">Medium</option>
                          <option value="Hard">Hard</option>
                          <option value="Very Hard">Very Hard</option>
                        </select>
                     </div>
                   </div>

                   <div>
                     <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Session Notes</label>
                     <textarea 
                       value={dailyLog}
                       onChange={(e) => setDailyLog(e.target.value)}
                       rows={5}
                       placeholder="Today I did Upper Limb muscles. Found the Brachial Plexus branches confusing, particularly the medial cord... Took me 2 hours."
                       className="w-full px-4 py-3 bg-black/5 hover:bg-black/10 focus:bg-white focus:outline-none focus:ring-2 focus:ring-black/20 rounded-2xl transition-all resize-none text-sm font-medium"
                     />
                   </div>

                   <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Attachments</label>
                      <div className="flex flex-wrap items-center gap-3">
                         <button 
                            type="button"
                            onClick={() => setShowCamera(true)}
                            className="px-4 py-2.5 bg-black/5 hover:bg-black/10 rounded-xl flex items-center space-x-2 transition-all cursor-pointer font-medium text-gray-700"
                         >
                           <Icons.Camera size={16} />
                           <span className="text-sm">Camera</span>
                         </button>
                         <label className="px-4 py-2.5 bg-black/5 hover:bg-black/10 rounded-xl flex items-center space-x-2 transition-all cursor-pointer font-medium text-gray-700">
                           <Icons.ImagePlus size={16} className="text-gray-600" />
                           <span className="text-sm">Upload</span>
                           <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} />
                         </label>
                         {base64Images.length > 0 && (
                            <span className="text-xs text-gray-500 font-semibold bg-black/5 px-3 py-1.5 rounded-lg">{base64Images.length} attached</span>
                         )}
                      </div>
                      {base64Images.length > 0 && (
                        <div className="flex space-x-2 mt-3 overflow-x-auto pb-2">
                           {base64Images.map((img, i) => (
                             <div key={i} className="relative w-16 h-16 rounded-md overflow-hidden border border-gray-200 shrink-0">
                               <img src={`data:${img.mimeType};base64,${img.data}`} alt="upload preview" className="object-cover w-full h-full" />
                               <button 
                                 onClick={() => setBase64Images(prev => prev.filter((_, idx) => idx !== i))}
                                 className="absolute top-1 right-1 bg-black/50 hover:bg-black p-0.5 rounded-full text-white"
                               >
                                  <Icons.X size={12} />
                               </button>
                             </div>
                           ))}
                        </div>
                      )}
                   </div>
                   
                   {errorMsg && (
                     <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">
                       {errorMsg}
                     </div>
                   )}

                   <div className="pt-2">
                     <button 
                       onClick={processLog}
                       disabled={isProcessing || (!dailyLog.trim() && base64Images.length === 0)}
                       className={cn(
                         "w-full py-4 rounded-[1.25rem] font-semibold transition-all shadow-md active:scale-95 flex items-center justify-center space-x-2 bg-black text-white hover:bg-gray-900 disabled:opacity-50 disabled:active:scale-100 font-bold"
                       )}
                     >
                       {isProcessing ? (
                         <>
                           <Icons.Loader2 size={18} className="animate-spin text-white" />
                           <span className="text-white">Analyzing Context...</span>
                         </>
                       ) : (
                         <>
                           <span>Save & Schedule</span>
                           <Icons.ArrowRight size={18} />
                         </>
                       )}
                     </button>
                   </div>
                 </div>
               </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showCamera && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed inset-0 z-50 bg-black flex flex-col"
          >
             <CameraViewfinder 
               onCapture={(dataUrl) => {
                 const match = dataUrl.match(/^data:(image\/[a-zA-Z]*);base64,(.*)$/);
                 if (match) {
                   setBase64Images(prev => [...prev, { mimeType: match[1], data: match[2] }]);
                 }
                 setShowCamera(false);
               }}
               onClose={() => setShowCamera(false)}
             />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

